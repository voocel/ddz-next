import Phaser from "phaser";
import { identifyCombination, suggestPlay, type CardId } from "@ddz/domain";
import { gameSnapshotSchema } from "@ddz/protocol";
import type { CardDto, GameEvent, GameSnapshotDto, RoundReplayDto } from "@ddz/protocol";
import { describeSelectedCards, toDomainCard, validateSelectedPlay } from "./playValidation";
import { bgmKey, BGM_VOLUME, cardsSoundKey, SOUND_FILES, type SoundKey } from "./sounds";
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
import { AVATAR_COUNT, avatarIndexes, themeAsset, type ThemeId } from "../theme";

export interface TableGameBridge {
  applyEvent(event: GameEvent): void;
  applyReplay(replay: RoundReplayDto | null, step: number): void;
  /** 出牌：校验当前选中的牌并提交（操作按钮在 React 控制行，经此触发画布内的选牌逻辑） */
  play(): void;
  /** 不出 */
  pass(): void;
  /** 提示：自动选中可压过上一手的牌 */
  tip(): void;
  /** 回合超时提醒：本地玩家剩余时间不多时由 React 控制行触发，播放闹钟音 */
  alertTimeout(): void;
}

interface TableSceneOptions {
  readonly localPlayerId: string;
  readonly theme: ThemeId;
  readonly onPass: () => void;
  readonly onPlay: (cards: readonly CardId[]) => void;
}

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

// 按相对本地玩家的座位渲染：0 = 自己（左下角），1 = 下家（右上），2 = 上家（左上）
const RELATIVE_SEAT_POSITIONS = [
  { x: 130, y: 648 },
  { x: 1064, y: 300 },
  { x: 216, y: 300 }
] as const;
// 出牌展示区回到上半部居中，把下半部让给操作控制行（操作按钮与闹钟现为 HTML 控制行）
const LAST_PLAY_Y = 330;
// 手牌横排贴底；选中的牌上抬 20px
const HAND_RESTING_Y = 632;
const HAND_SELECTED_Y = 612;

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
  private landlordCardsLayer?: Phaser.GameObjects.Container;
  private settlementLayer?: Phaser.GameObjects.Container;
  private handLayer?: Phaser.GameObjects.Container;
  private lastPlayLayer?: Phaser.GameObjects.Container;
  private seatsLayer?: Phaser.GameObjects.Container;
  private renderedHandCards: RenderedHandCard[] = [];
  private bgm: Phaser.Sound.BaseSound | undefined;
  private bgmStopped = false;
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
    const asset = (file: string) => themeAsset(this.options.theme, file);
    // 牌面统一用一套清晰素材，不随主题切换；仅牌背随主题变化
    const faceAsset = (file: string) => themeAsset("cartoon", file);
    this.load.image("table-bg", asset("bg_table.jpg"));
    this.load.image("card-back", asset("card_back.png"));
    // 座位头像：每套主题 12 张默认头像，按玩家 id 确定性取用
    for (let i = 1; i <= AVATAR_COUNT; i += 1) {
      this.load.image(`avatar-${i}`, asset(`avatar/${i}.png`));
    }
    this.load.image("suit-hearts", faceAsset("suit_heart.png"));
    this.load.image("suit-diamonds", faceAsset("suit_diamond.png"));
    this.load.image("suit-spades", faceAsset("suit_spade.png"));
    this.load.image("suit-clubs", faceAsset("suit_club.png"));
    this.load.image("joker-big", faceAsset("joker_big.png"));
    this.load.image("joker-small", faceAsset("joker_small.png"));
    this.load.image("ribbon-title", asset("ribbon_title.png"));

    for (const [key, file] of Object.entries(SOUND_FILES)) {
      this.load.audio(key, `/assets/audio/${file}`);
    }
  }

  create(): void {
    this.fitStageToCanvas();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitStageToCanvas, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitStageToCanvas, this);
      this.stopBgm();
    });
    this.startBgm();
    this.add.image(640, 360, "table-bg").setDisplaySize(1280, 720);

    this.feedbackText = this.add
      .text(640, 408, "", {
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
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.beginHandDrag(pointer);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      this.handleHandDragMove(pointer);
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      this.finishHandDrag(pointer);
    });

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

    if (event.type === "landlord_bid") {
      this.playSound(event.called ? "sound-call" : "sound-nocall");
    }

    if (event.type === "landlord_robbed") {
      this.playSound(event.robbed ? "sound-rob" : "sound-norob");
    }

    if (event.type === "cards_played") {
      this.playSound(cardsSoundKey(event.play.combination.kind, event.play.cards[0]?.id));
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
    const currentStep = Math.min(Math.max(step, 0), Math.max(0, replay.actions.length - 1));
    const action = replay.actions[currentStep];
    const replayNickname = (playerId: string): string | undefined =>
      replay.players.find((player) => player.playerId === playerId)?.nickname;
    const parsed = action ? parseReplaySnapshot(action.payload.snapshot) : null;
    // 历史快照 payload 不存昵称，渲染前从回放玩家列表补齐
    const snapshot = parsed
      ? {
          ...parsed,
          players: parsed.players.map((player) =>
            player.nickname === undefined && replayNickname(player.id) !== undefined
              ? { ...player, nickname: replayNickname(player.id) }
              : player
          )
        }
      : null;
    const replayActor = (playerId: string): string =>
      formatActor(playerId, this.options.localPlayerId, replayNickname(playerId));
    if (snapshot) {
      this.snapshot = snapshot;
      this.renderSnapshotViews(snapshot);
      this.setFeedback(action ? formatReplayAction(action, replayActor) : "暂无回放事件");
    } else {
      this.renderReplaySeats(replay);
      this.renderLandlordCards(null);
      this.settlementLayer?.setVisible(false);
      this.setFeedback(action ? `历史事件缺少快照: ${formatReplayAction(action, replayActor)}` : "暂无回放事件");
    }

    if (snapshot?.lastPlay) {
      this.renderLastPlay(snapshot.lastPlay.cards, snapshot.lastPlay.playerId, false);
    } else if (action?.type === "cards_played") {
      this.renderReplayLastPlay(parseReplayCardIds(action.payload.cards));
    } else {
      this.lastPlayLayer?.removeAll(true);
    }
  }

  /** 出牌：校验当前选中的牌，非法则画布内反馈，合法则提交并清空选牌 */
  play(): void {
    const validation = validateSelectedPlay(this.hand, this.selected, this.snapshot, this.options.localPlayerId);
    if (!validation.ok) {
      this.setFeedback(validation.reason);
      return;
    }
    // 出牌音效改由权威 cards_played 事件按牌型播放（避免乐观音 + 事件回声重复）
    this.options.onPlay(validation.cardIds);
    this.selected.clear();
    this.renderHand();
  }

  /** 不出 */
  pass(): void {
    if (!this.ensureLocalTurn()) {
      return;
    }
    // 不出音效改由权威 player_passed 事件播放（避免乐观音 + 事件回声重复）
    this.options.onPass();
  }

  /** 提示：选中可压过上一手的牌 */
  tip(): void {
    this.applySuggestion();
  }

  private createSeatPlate(x: number, y: number, active: boolean): Phaser.GameObjects.Graphics {
    const plate = this.add.graphics();
    const left = x - 107;
    const top = y - 37;
    // 像素主题用硬直角方块 + 厚阴影，卡通主题保留奶油圆角
    if (this.options.theme === "pixel") {
      plate.fillStyle(0x3a2a18, active ? 0.9 : 0.6);
      plate.fillRect(left + 4, top + 5, 214, 74);
      plate.fillStyle(0xfff3da, 0.97);
      plate.fillRect(left, top, 214, 74);
      plate.lineStyle(active ? 4 : 2, active ? 0xffb300 : 0x8c5a22, 1);
      plate.strokeRect(left, top, 214, 74);
      return plate;
    }

    plate.fillStyle(0x8c5318, active ? 0.85 : 0.5);
    plate.fillRoundedRect(left + 3, top + 5, 214, 74, 18);
    plate.fillStyle(0xfff6e0, 0.96);
    plate.fillRoundedRect(left, top, 214, 74, 18);
    plate.lineStyle(active ? 4 : 2, active ? 0xffb300 : 0xb9772f, 1);
    plate.strokeRoundedRect(left, top, 214, 74, 18);
    return plate;
  }

  /** 座位头像：按玩家 id 确定性取一张主题头像，居中在座位牌左侧 */
  private createSeatAvatar(x: number, y: number, index: number): Phaser.GameObjects.Image {
    return this.add.image(x - 80, y, `avatar-${index}`).setDisplaySize(52, 52);
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
      const y = selected ? HAND_SELECTED_Y : HAND_RESTING_Y;
      // 手牌横向重叠，右侧牌盖在左侧牌上；除最后一张外只露出左侧 gap 宽的可见条。
      // 命中区限制在可见条，且统一走场景级 pointerdown + findRenderedHandCard 做世界坐标命中，
      // 不用每张牌各自 setInteractive——大量重叠的 Container 命中区会被 Phaser 整体错位一张。
      const isLast = index === this.hand.length - 1;
      const hitWidth = isLast ? cardWidth : gap;
      const cardFace = this.createCardFace(x, y, formatCard(card), isRed(card), {
        selected,
        width: cardWidth,
        height: cardHeight
      });
      this.renderedHandCards.push({
        id: cardId,
        bounds: new Phaser.Geom.Rectangle(x - cardWidth / 2, y - cardHeight / 2, hitWidth, cardHeight)
      });

      this.handLayer?.add(cardFace);
    });
  }

  /** 场景级手牌命中：用 findRenderedHandCard 在世界坐标判定，避开 Phaser 重叠 Container 命中区错位 */
  private beginHandDrag(pointer: Phaser.Input.Pointer): void {
    if (this.replayMode) {
      return;
    }
    const cardId = this.findRenderedHandCard(pointer.worldX, pointer.worldY);
    if (!cardId) {
      // 点击手牌区域外：取消全部已选
      if (this.selected.size > 0) {
        this.selected.clear();
        this.setFeedback("");
        this.renderHand();
      }
      return;
    }
    const mode = this.selected.has(cardId) ? "remove" : "add";
    this.dragSelection = {
      pointerId: pointer.id,
      mode,
      touched: new Set<CardId>(),
      moved: false
    };
    this.applyDragSelection(cardId);
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
  }

  private renderStatus(snapshot: GameSnapshotDto): void {
    this.phaseText
      ?.setText(describePhasePrompt(snapshot, this.options.localPlayerId))
      .setVisible(!snapshot.settlement);
  }

  private setFeedback(message: string): void {
    this.feedbackText?.setText(message).setVisible(message.length > 0);
  }

  private renderSeats(snapshot: GameSnapshotDto): void {
    const seatsLayer = this.seatsLayer;
    if (!seatsLayer) {
      return;
    }

    seatsLayer.removeAll(true);
    const localSeat = snapshot.players.find((player) => player.id === this.options.localPlayerId)?.seat ?? null;
    const showReady = snapshot.phase === "waiting" || snapshot.phase === "ready";

    const seatAvatarIndexes = avatarIndexes(snapshot.players.map((player) => player.id));
    snapshot.players.forEach((player, seatIndex) => {
      const position = this.seatPositionFor(player.seat, localSeat);
      const isLocal = player.id === this.options.localPlayerId;
      const active = snapshot.currentPlayerId === player.id;
      const plate = this.createSeatPlate(position.x, position.y, active);
      const avatar = this.createSeatAvatar(position.x, position.y, seatAvatarIndexes[seatIndex]!);
      const landlord = snapshot.landlordId === player.id ? " 👑地主" : "";
      const label = this.add.text(
        position.x - 54,
        position.y - 28,
        `${formatActor(player.id, this.options.localPlayerId, player.nickname)}${landlord}`,
        {
          ...TEXT_STYLE,
          fontSize: "14px",
          fontStyle: "900",
          color: INK
        }
      );
      const offline = !player.connected ? "  已离线" : "";
      // 对手的余牌数由牌背堆徽章展示，文字行不再重复
      const handInfo = isLocal ? `手牌 ${player.handCount}  ` : "";
      const meta = this.add.text(
        position.x - 54,
        position.y - 4,
        `${showReady ? (player.ready ? "已准备  " : "未准备  ") : ""}${handInfo}分 ${player.score}${offline}`,
        {
          ...TEXT_STYLE,
          fontSize: "12px",
          color: player.connected ? INK_SOFT : "#e25840"
        }
      );

      if (!isLocal) {
        this.addCardBackStack(seatsLayer, position.x, position.y + 67, player.handCount);
      }
      seatsLayer.add([plate, avatar, label, meta]);
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
    const label = this.add.text(640, 74, revealed ? "地主底牌" : "底牌待定", {
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
    const ribbon = this.add.image(640, 262, "ribbon-title").setDisplaySize(248, 62);
    const title = this.add.text(640, 258, "本局结算", {
      ...TEXT_STYLE,
      fontSize: "24px",
      fontStyle: "900",
      color: "#ffffff"
    }).setOrigin(0.5);
    title.setShadow(0, 2, "rgba(80, 40, 0, 0.45)", 2);
    layer.add([backdrop, ribbon, title]);

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
      const y = LAST_PLAY_Y;
      const cardFace = this.createCardFace(x, y, formatCard(card), isRed(card), {
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
      const cardFace = this.createCardFace(x, LAST_PLAY_Y, formatCardId(cardId), isRedCardId(cardId), {
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

    const seatAvatarIndexes = avatarIndexes(replay.players.map((player) => player.playerId));
    replay.players.forEach((player, seatIndex) => {
      const position = this.seatPositionFor(player.seat, localSeat);
      const plate = this.createSeatPlate(position.x, position.y, false);
      const avatar = this.createSeatAvatar(position.x, position.y, seatAvatarIndexes[seatIndex]!);
      const label = this.add.text(
        position.x - 54,
        position.y - 28,
        formatActor(player.playerId, this.options.localPlayerId, player.nickname),
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

      // 回放数据不含逐步手牌数，不渲染牌背堆，避免显示假数量
      seatsLayer.add([plate, avatar, label, meta]);
    });
  }

  /**
   * 牌面文字的纹理超采样倍率。相机为 fit 缩放（非整数倍），文字纹理须按当前
   * 相机缩放倍率渲染才能 1:1 显示；只取 dpr 会在 zoom>dpr 时上采样发虚。
   */
  private cardTextResolution(): number {
    return Math.max(getTableDevicePixelRatio(), Math.ceil(this.cameras.main.zoom));
  }

  private createCardFace(
    x: number,
    y: number,
    label: string,
    red: boolean,
    options: {
      readonly fontSize?: string;
      readonly height: number;
      readonly selected?: boolean;
      readonly width: number;
    }
  ): Phaser.GameObjects.Container {
    const width = options.width;
    const height = options.height;
    const color = red ? "#c41f1f" : "#171717";
    const suit = readCardSuit(label);
    const rank = suit ? label.slice(0, -1) : label;
    // 牌面统一圆角奶油底板，不随主题变化（仅牌背受主题影响）
    const radius = Math.max(5, Math.round(width * 0.08));
    const innerRadius = Math.max(3, radius - 2);
    const container = this.add.container(x, y);
    const graphics = this.add.graphics();

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
          resolution: this.cardTextResolution(),
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
    const res = this.cardTextResolution();
    const cornerX = -width / 2 + Math.max(6, width * 0.1);
    const cornerY = -height / 2 + Math.max(5, height * 0.08);
    const rightX = width / 2 - Math.max(6, width * 0.1);
    const rightY = height / 2 - Math.max(5, height * 0.08);
    const suitKey = suitImageKey(suit);
    const centerSuit = this.add
      .image(0, height * 0.08, suitKey)
      .setDisplaySize(width * 0.46, width * 0.46)
      .setAlpha(0.94);
    const cornerSuitWidth = Math.max(11, width * 0.17);
    const topRank = this.add.text(cornerX, cornerY, rank, cardTextStyle(rankSize, color, res)).setOrigin(0, 0);
    const topSuit = this.add
      .image(cornerX + width * 0.02, cornerY + height * 0.22, suitKey)
      .setDisplaySize(cornerSuitWidth, cornerSuitWidth)
      .setOrigin(0, 0);
    const bottomRank = this.add.text(rightX, rightY, rank, cardTextStyle(rankSize, color, res)).setOrigin(1, 1);
    const bottomSuit = this.add
      .image(rightX - width * 0.02, rightY - height * 0.22, suitKey)
      .setDisplaySize(cornerSuitWidth, cornerSuitWidth)
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
    const cornerSize = fontSize ?? `${Math.max(13, Math.round(width * 0.2))}px`;
    const res = this.cardTextResolution();
    const cornerX = -width / 2 + Math.max(6, width * 0.1);
    const cornerY = -height / 2 + Math.max(6, height * 0.08);
    const rightX = width / 2 - Math.max(6, width * 0.1);
    const rightY = height / 2 - Math.max(6, height * 0.08);
    const jokerKey = red ? "joker-big" : "joker-small";
    const portrait = this.add.image(0, height * 0.05, jokerKey);
    portrait.setScale(Math.min((height * 0.62) / portrait.height, (width * 0.66) / portrait.width));
    const topText = this.add.text(cornerX, cornerY, label, cardTextStyle(cornerSize, color, res)).setOrigin(0, 0);
    const bottomText = this.add.text(rightX, rightY, label, cardTextStyle(cornerSize, color, res)).setOrigin(1, 1);

    container.add([portrait, topText, bottomText]);
  }

  /** 对手手牌：一张牌一张背的紧凑横排，余牌数徽章叠在中央 */
  private addCardBackStack(layer: Phaser.GameObjects.Container, x: number, y: number, count: number): void {
    if (count <= 0) {
      return;
    }

    const visibleCards = Math.min(20, count);
    const overlapOffset = 11;
    const startX = x - ((visibleCards - 1) * overlapOffset) / 2;
    for (let index = 0; index < visibleCards; index += 1) {
      const cardBack = this.add.image(startX + index * overlapOffset, y, "card-back").setDisplaySize(36, 50);
      layer.add(cardBack);
    }

    const countText = this.add
      .text(x, y, `${count}`, {
        ...TEXT_STYLE,
        fontSize: "17px",
        fontStyle: "900",
        color: "#ffffff",
        stroke: INK,
        strokeThickness: 4
      })
      .setOrigin(0.5);
    layer.add(countText);
  }

  /** 回合超时提醒（由 React 控制行在本地玩家剩余时间不多时触发） */
  alertTimeout(): void {
    this.playSound("sound-alarm");
  }

  /** 进入牌桌后按主题循环播放背景音乐；音频上下文若被浏览器锁定则等解锁后再起播 */
  private startBgm(): void {
    const key = bgmKey(this.options.theme);
    const begin = (): void => {
      if (this.bgm || this.bgmStopped) {
        return;
      }
      // 背景音乐失败只记录日志，不打断游戏（与 playSound 一致）
      try {
        this.bgm = this.sound.add(key, { loop: true, volume: BGM_VOLUME });
        this.bgm.play();
      } catch (error) {
        console.warn(`背景音乐播放失败: ${key}`, error);
      }
    };
    if (this.sound.locked) {
      this.sound.once(Phaser.Sound.Events.UNLOCKED, begin);
    } else {
      begin();
    }
  }

  /** 离开牌桌时停止背景音乐（destroy 会同时停止播放并释放资源） */
  private stopBgm(): void {
    this.bgmStopped = true;
    this.bgm?.destroy();
    this.bgm = undefined;
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

function cardTextStyle(fontSize: string, color: string, resolution: number): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontSize,
    fontStyle: "900",
    color,
    resolution
  };
}

function parseReplaySnapshot(value: unknown): GameSnapshotDto | null {
  const parsed = gameSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

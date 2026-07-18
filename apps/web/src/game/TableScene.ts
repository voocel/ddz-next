import Phaser from "phaser";
import { identifyCombination, suggestPlay, type CardId } from "@ddz/domain";
import { gameSnapshotSchema } from "@ddz/protocol";
import type { CardDto, GameEvent, GameSnapshotDto, RoundReplayDto } from "@ddz/protocol";
import { describeSelectedCards, toDomainCard, validateSelectedPlay } from "./playValidation";
import { HandSelection, type HandDragResult } from "./handSelection";
import { cardsSoundKey, SOUND_FILES, type SoundKey } from "./sounds";
import type { AudioLevels } from "../audio";
import {
  describeEventFeedback,
  describePhasePrompt,
  formatActor,
  formatReplayAction,
  parseReplayCardIds,
  replayRemainingCards,
  replayViewpoint
} from "./tablePresentation";
import { TABLE_STAGE_HEIGHT, TABLE_STAGE_WIDTH } from "./tableConfig";
import { AVATAR_COUNT, themeAsset, type ThemeId } from "../theme";
import { HandLayer, TableCardLayers } from "./cardLayers";
import { SeatLayer } from "./seatLayer";
import { TABLE_INK, TABLE_TEXT_STYLE } from "./tableStage";

export interface TableGameBridge {
  applyEvent(event: GameEvent): void;
  applyReplay(replay: RoundReplayDto | null, step: number): void;
  /** 出牌：校验当前选中的牌并提交（操作按钮在 React 控制行，经此触发画布内的选牌逻辑） */
  play(): void;
  /** 不出 */
  pass(): void;
  /** 提示：自动选中可压过上一手的牌 */
  tip(): void;
  /** 回合超时提醒：本地玩家剩余时间不多时由 React 回合计时器触发，播放闹钟音 */
  alertTimeout(): void;
  /** 设置音效音量（0..1，0 即静音）：React 音效滑块变动时实时下发（背景音乐由 App 级全局管理） */
  setSfxLevel(level: number): void;
}

interface TableSceneOptions {
  readonly localPlayerId: string;
  readonly theme: ThemeId;
  readonly audio: AudioLevels;
  readonly onPass: () => void;
  readonly onPlay: (cards: readonly CardId[]) => void;
}

export class TableScene extends Phaser.Scene implements TableGameBridge {
  private readonly selection = new HandSelection();
  private hand: CardDto[] = [];
  private revealedHands = new Map<string, readonly CardDto[]>();
  private snapshot: GameSnapshotDto | null = null;
  private replayMode = false;
  // 回放中占据底部手牌区的玩家（公开明牌局为座位 0 的选手，私有复盘为查看者本人）
  private replayViewpointId: string | null = null;
  // React 状态可能先于场景 create() 到达，缓存待应用的回放与进入回放前的直播状态
  private replayState: { readonly replay: RoundReplayDto; readonly step: number } | null = null;
  private liveState: {
    readonly snapshot: GameSnapshotDto | null;
    readonly hand: CardDto[];
    readonly revealedHands: ReadonlyMap<string, readonly CardDto[]>;
  } | null = null;
  private background?: Phaser.GameObjects.Image;
  private phaseText?: Phaser.GameObjects.Text;
  private actionText?: Phaser.GameObjects.Text;
  private feedbackText?: Phaser.GameObjects.Text;
  private seatLayer?: SeatLayer;
  private handLayer?: HandLayer;
  private cardLayers?: TableCardLayers;
  private sfxLevel: number;

  constructor(private readonly options: TableSceneOptions) {
    super("TableScene");
    this.sfxLevel = options.audio.sfx;
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
    });
    this.background = this.add.image(640, 360, "table-bg").setDisplaySize(1280, 720);
    this.coverBackground(this.cameras.main.zoom);

    this.feedbackText = this.add
      .text(640, 408, "", {
        ...TABLE_TEXT_STYLE,
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
        ...TABLE_TEXT_STYLE,
        fontSize: "30px",
        fontStyle: "900",
        color: "#ffffff",
        stroke: TABLE_INK,
        strokeThickness: 6
      })
      .setOrigin(0.5)
      .setDepth(15);
    this.actionText = this.add
      .text(640, 298, "", {
        ...TABLE_TEXT_STYLE,
        fontSize: "22px",
        color: "#fff6e0",
        backgroundColor: "rgba(74, 42, 16, 0.78)"
      })
      .setOrigin(0.5)
      .setPadding(18, 8, 18, 8)
      .setDepth(16)
      .setAlpha(0);

    this.seatLayer = new SeatLayer(this, this.options.theme, this.options.localPlayerId);
    this.cardLayers = new TableCardLayers(this);
    this.handLayer = new HandLayer(this);
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.applyDragResult(this.selection.beginDrag(pointer, this.replayMode));
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      this.applyDragResult(this.selection.moveDrag(pointer));
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      this.applyDragResult(this.selection.finishDrag(pointer));
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
    this.coverBackground(scale);
  }

  /** 背景图按 cover 延展铺满相机可视区：画布比例偏离 16:9 时用背景吃掉 letterbox，不露画布底色 */
  private coverBackground(zoom: number): void {
    if (!this.background || zoom <= 0) {
      return;
    }
    const visibleWidth = this.scale.width / zoom;
    const visibleHeight = this.scale.height / zoom;
    const cover = Math.max(visibleWidth / TABLE_STAGE_WIDTH, visibleHeight / TABLE_STAGE_HEIGHT);
    this.background.setDisplaySize(TABLE_STAGE_WIDTH * cover, TABLE_STAGE_HEIGHT * cover);
  }

  applyEvent(event: GameEvent): void {
    this.setFeedback("");
    const feedback = describeEventFeedback(event, this.options.localPlayerId);
    if (feedback) {
      this.showActionFeedback(feedback, event.type === "command_rejected" ? 0xff8f70 : 0xd6f5dc);
    }

    if ("snapshot" in event) {
      this.snapshot = event.snapshot;
      this.applyRevealedHands(event);
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
      this.cardLayers?.clearLastPlay();
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
      this.replayViewpointId = null;
      if (wasReplay) {
        // 退出回放：恢复进入前暂存的直播状态
        this.snapshot = this.liveState?.snapshot ?? null;
        this.hand = this.liveState?.hand ?? [];
        this.revealedHands = new Map(this.liveState?.revealedHands ?? []);
        this.liveState = null;
        this.selection.clear();
        this.renderLiveState();
      }
      this.setFeedback("");
      return;
    }

    if (!wasReplay) {
      // 进入回放：暂存直播状态，退出时恢复
      this.liveState = { snapshot: this.snapshot, hand: this.hand, revealedHands: new Map(this.revealedHands) };
    }
    this.replayState = { replay, step };

    this.selection.clear();
    this.snapshot = null;
    const currentStep = Math.min(Math.max(step, 0), Math.max(0, replay.actions.length - 1));
    const viewpoint = replayViewpoint(replay, this.options.localPlayerId);
    this.replayViewpointId = viewpoint?.playerId ?? null;
    // 明牌复盘：底部视角选手的当步手牌走手牌区，其余选手摊在座位旁（私有复盘 revealedHands 为空，行为不变）
    this.revealedHands = new Map(
      replay.revealedHands
        .filter((entry) => entry.playerId !== viewpoint?.playerId)
        .map((entry) => [entry.playerId, replayRemainingCards(replay, currentStep, entry.playerId, entry.cards)])
    );
    this.hand = viewpoint ? replayRemainingCards(replay, currentStep, viewpoint.playerId, viewpoint.initial) : [];
    this.renderHand();
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
      this.setFeedback(action ? `历史事件缺少快照: ${formatReplayAction(action, replayActor)}` : "暂无回放事件");
    }

    if (snapshot?.lastPlay) {
      this.renderLastPlay(snapshot.lastPlay.cards, snapshot.lastPlay.playerId, false);
    } else if (action?.type === "cards_played") {
      this.renderReplayLastPlay(parseReplayCardIds(action.payload.cards));
    } else {
      this.cardLayers?.clearLastPlay();
    }
  }

  /** 出牌：校验当前选中的牌，非法则画布内反馈，合法则提交并清空选牌 */
  play(): void {
    const validation = validateSelectedPlay(this.hand, this.selection.ids(), this.snapshot, this.options.localPlayerId);
    if (!validation.ok) {
      this.setFeedback(validation.reason);
      return;
    }
    // 出牌音效改由权威 cards_played 事件按牌型播放（避免乐观音 + 事件回声重复）
    this.options.onPlay(validation.cardIds);
    this.selection.clear();
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

  private renderHand(): void {
    const layer = this.handLayer;
    if (!layer) {
      return;
    }

    this.selection.setRendered(layer.render(this.hand, (id) => this.selection.has(id)));
  }

  /** 拖拽选牌的副作用（重绘/清反馈/选牌音）由 HandSelection 的结果驱动，机制本身见 handSelection.ts */
  private applyDragResult(result: HandDragResult): void {
    if (result.clearFeedback) {
      this.setFeedback("");
    }
    if (result.playSelect) {
      this.playSound("sound-select");
    }
    if (result.render) {
      this.renderHand();
    }
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
      this.selection.clear();
      this.renderHand();
      this.setFeedback("没有可压过上一手的牌");
      return;
    }

    this.selection.select(suggestion.map((card) => card.id));
    this.playSound("sound-select");
    this.renderHand();
    this.setFeedback(`提示: ${describeSelectedCards(this.hand, this.selection.ids())}`);
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

  /** 渲染快照对应的全部视图（座位/底牌/状态行） */
  private renderSnapshotViews(snapshot: GameSnapshotDto): void {
    this.renderStatus(snapshot);
    this.renderSeats(snapshot);
    this.renderLandlordCards(snapshot);
  }

  /** 按快照同步上一手牌区（无动画） */
  private syncLastPlay(snapshot: GameSnapshotDto): void {
    if (snapshot.lastPlay) {
      this.renderLastPlay(snapshot.lastPlay.cards, snapshot.lastPlay.playerId, false);
    } else {
      this.cardLayers?.clearLastPlay();
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

    this.seatLayer?.clear();
    this.cardLayers?.clearLandlordCards();
    this.cardLayers?.clearLastPlay();
    this.phaseText?.setText("等待玩家入座").setVisible(true);
  }

  private applyRevealedHands(event: GameEvent): void {
    if (!("snapshot" in event)) {
      return;
    }
    if (event.snapshot.phase !== "settled") {
      this.revealedHands.clear();
      return;
    }
    if ("revealedHands" in event && event.revealedHands) {
      this.revealedHands = new Map(event.revealedHands.map((item) => [item.playerId, item.cards]));
    } else {
      this.revealedHands.clear();
    }
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
    this.seatLayer?.renderSnapshot(snapshot, this.revealedHands, this.replayViewpointId);
  }

  private renderLandlordCards(snapshot: GameSnapshotDto | null): void {
    this.cardLayers?.renderLandlordCards(snapshot);
  }

  private renderLastPlay(cards: readonly CardDto[], playerId?: string, animated = true): void {
    const source = playerId
      ? this.seatLayer?.findSnapshotPosition(this.snapshot, playerId, this.replayViewpointId) ?? null
      : null;
    this.cardLayers?.renderLastPlay(cards, source, animated);
  }

  private renderReplayLastPlay(cardIds: readonly string[]): void {
    this.cardLayers?.renderReplayLastPlay(cardIds);
  }

  private renderReplaySeats(replay: RoundReplayDto): void {
    this.seatLayer?.renderReplay(replay);
  }

  /** 回合超时提醒（由 React 控制行在本地玩家剩余时间不多时触发） */
  alertTimeout(): void {
    this.playSound("sound-alarm");
  }

  /** 实时设置音效音量（背景音乐由 App 级全局管理，不在场景内） */
  setSfxLevel(level: number): void {
    this.sfxLevel = level;
  }

  private playSound(key: SoundKey): void {
    if (this.sfxLevel <= 0) {
      return;
    }
    // 音效失败只记录日志，不打断游戏流程
    try {
      const base = key === "sound-select" ? 0.45 : 0.62;
      const played = this.sound.play(key, { volume: base * this.sfxLevel });
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
    this.selection.prune(new Set(this.hand.map((card) => card.id)));
  }

}

function parseReplaySnapshot(value: unknown): GameSnapshotDto | null {
  const parsed = gameSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

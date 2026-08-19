import type Phaser from "phaser";
import type { CardDto, GameSnapshotDto, RoundReplayDto } from "@ddz/protocol";
import { avatarIndexes, type ThemeId } from "../theme";
import { createCardFace, formatCard, isRed } from "./cardFace";
import { formatActor, formatScore } from "./tablePresentation";
import { seatPositionFor, TABLE_INK, TABLE_INK_SOFT, TABLE_TEXT_STYLE, type StagePoint } from "./tableStage";

export class SeatLayer {
  private readonly layer: Phaser.GameObjects.Container;
  private glowTween: Phaser.Tweens.Tween | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly theme: ThemeId,
    private readonly localPlayerId: string
  ) {
    this.layer = scene.add.container(0, 0);
  }

  clear(): void {
    // 光晕呼吸 tween 随座位层重建一并销毁,防止残留 tween 引用已销毁对象
    this.glowTween?.remove();
    this.glowTween = null;
    this.layer.removeAll(true);
  }

  renderSnapshot(
    snapshot: GameSnapshotDto,
    revealedHands: ReadonlyMap<string, readonly CardDto[]>,
    bottomPlayerId: string | null = null
  ): void {
    this.clear();
    // 底部视角：本地玩家优先；公开复盘（查看者未入局）由指定选手补位，其手牌走底部手牌区
    const localSeat =
      snapshot.players.find((player) => player.id === this.localPlayerId)?.seat ??
      snapshot.players.find((player) => player.id === bottomPlayerId)?.seat ??
      null;
    // 纯观战（无人占底部手牌区）：座位 0 改为底部居中展示
    const bottomCentered = localSeat === null;
    const showReady = snapshot.phase === "waiting" || snapshot.phase === "ready";
    const indexes = avatarIndexes(snapshot.players.map((player) => player.id));

    snapshot.players.forEach((player, seatIndex) => {
      const position = seatPositionFor(player.seat, localSeat, bottomCentered);
      const isLocal = player.id === this.localPlayerId || player.id === bottomPlayerId;
      const active = snapshot.currentPlayerId === player.id;
      if (active) {
        this.layer.add(this.createSeatGlow(position));
      }
      const plate = this.createSeatPlate(position, active);
      const avatar = this.createSeatAvatar(position, indexes[seatIndex] ?? 1);
      const landlordBadge = snapshot.landlordId === player.id ? this.createLandlordBadge(position) : [];
      const label = this.scene.add.text(
        position.x - 42,
        position.y - 28,
        formatActor(player.id, this.localPlayerId, player.nickname),
        {
          ...TABLE_TEXT_STYLE,
          fontSize: "14px",
          fontStyle: "900",
          color: TABLE_INK
        }
      );
      const offline = !player.connected ? "  已离线" : "";
      const handInfo = isLocal ? `手牌 ${player.handCount}  ` : "";
      const meta = this.scene.add.text(
        position.x - 42,
        position.y - 4,
        `${showReady ? (player.ready ? "已准备  " : "未准备  ") : ""}${handInfo}分 ${player.score}${offline}`,
        {
          ...TABLE_TEXT_STYLE,
          fontSize: "12px",
          color: player.connected ? TABLE_INK_SOFT : "#e25840"
        }
      );

      if (!isLocal) {
        // 直播仅结算时才填充 revealedHands（见 TableScene.applyRevealedHands）；明牌复盘则逐步填充
        const revealed = revealedHands.get(player.id);
        if (revealed) {
          this.addRevealedHand(position.x, position.y + 70, revealed);
        } else {
          this.addCardBackStack(position.x, position.y + 67, player.handCount);
        }
      }

      this.layer.add([plate, avatar, ...landlordBadge, label, meta]);
    });
  }

  renderReplay(replay: RoundReplayDto): void {
    this.clear();
    const localSeat = replay.players.find((player) => player.playerId === this.localPlayerId)?.seat ?? null;
    const indexes = avatarIndexes(replay.players.map((player) => player.playerId));

    replay.players.forEach((player, seatIndex) => {
      const position = seatPositionFor(player.seat, localSeat, localSeat === null);
      const plate = this.createSeatPlate(position, false);
      const avatar = this.createSeatAvatar(position, indexes[seatIndex] ?? 1);
      const label = this.scene.add.text(
        position.x - 42,
        position.y - 28,
        formatActor(player.playerId, this.localPlayerId, player.nickname),
        {
          ...TABLE_TEXT_STYLE,
          fontSize: "14px",
          fontStyle: "900",
          color: TABLE_INK
        }
      );
      const meta = this.scene.add.text(
        position.x - 42,
        position.y - 4,
        `分 ${formatScore(player.score)}`,
        {
          ...TABLE_TEXT_STYLE,
          fontSize: "12px",
          color: TABLE_INK_SOFT
        }
      );

      // 回放数据不含逐步手牌数，不渲染牌背堆，避免显示假数量。
      this.layer.add([plate, avatar, label, meta]);
    });
  }

  findSnapshotPosition(
    snapshot: GameSnapshotDto | null,
    playerId: string,
    bottomPlayerId: string | null = null
  ): StagePoint | null {
    const players = snapshot?.players;
    const player = players?.find((item) => item.id === playerId);
    if (!player) {
      return null;
    }

    // 与 renderSnapshot 同款视角推导，保证出牌飞入动画的起点与座位渲染一致
    const localSeat =
      players?.find((item) => item.id === this.localPlayerId)?.seat ??
      players?.find((item) => item.id === bottomPlayerId)?.seat ??
      null;
    return seatPositionFor(player.seat, localSeat, localSeat === null);
  }

  /** 当前行动位座位牌的呼吸光晕:三圈由内向外渐弱的金色描边模拟柔光,整体做透明度+缩放呼吸。 */
  private createSeatGlow(position: StagePoint): Phaser.GameObjects.Graphics {
    // 光晕在自身局部坐标以 (0,0) 为牌面中心绘制,再定位到座位——缩放呼吸才会以牌面为轴心
    const glow = this.scene.add.graphics({ x: position.x, y: position.y });
    const rings = [
      { pad: 4, alpha: 0.5, width: 6 },
      { pad: 10, alpha: 0.26, width: 8 },
      { pad: 17, alpha: 0.12, width: 10 }
    ];
    for (const { pad, alpha, width } of rings) {
      glow.lineStyle(width, 0xffb300, alpha);
      if (this.theme === "pixel") {
        glow.strokeRect(-107 - pad, -37 - pad, 214 + pad * 2, 74 + pad * 2);
      } else {
        glow.strokeRoundedRect(-107 - pad, -37 - pad, 214 + pad * 2, 74 + pad * 2, 18 + pad);
      }
    }
    this.glowTween = this.scene.tweens.add({
      targets: glow,
      alpha: { from: 0.35, to: 1 },
      scaleX: { from: 1, to: 1.03 },
      scaleY: { from: 1, to: 1.08 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut"
    });
    return glow;
  }

  private createSeatPlate(position: StagePoint, active: boolean): Phaser.GameObjects.Graphics {
    const plate = this.scene.add.graphics();
    const left = position.x - 107;
    const top = position.y - 37;
    if (this.theme === "pixel") {
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

  private createSeatAvatar(position: StagePoint, index: number): Phaser.GameObjects.Image {
    return this.scene.add.image(position.x - 70, position.y, `avatar-${index}`).setDisplaySize(52, 52);
  }

  /** 地主标识盖在头像上(头顶歪戴皇冠 + 底沿金色「地主」小徽章),不挤占昵称行——长模型名不再溢出座位牌 */
  private createLandlordBadge(position: StagePoint): Phaser.GameObjects.GameObject[] {
    const avatarX = position.x - 70;
    const avatarY = position.y;
    // 头像位于面板左侧:皇冠歪戴左上角,避免侵占右侧昵称文字区
    const crown = this.scene.add
      .text(avatarX - 16, avatarY - 26, "👑", { fontSize: "17px" })
      .setOrigin(0.5)
      .setAngle(-22);
    const pillWidth = 42;
    const pillHeight = 17;
    const pill = this.scene.add.graphics();
    pill.fillStyle(0xffb300, 1);
    pill.lineStyle(2, 0x8c5a22, 1);
    if (this.theme === "pixel") {
      pill.fillRect(avatarX - pillWidth / 2, avatarY + 18, pillWidth, pillHeight);
      pill.strokeRect(avatarX - pillWidth / 2, avatarY + 18, pillWidth, pillHeight);
    } else {
      pill.fillRoundedRect(avatarX - pillWidth / 2, avatarY + 18, pillWidth, pillHeight, 8);
      pill.strokeRoundedRect(avatarX - pillWidth / 2, avatarY + 18, pillWidth, pillHeight, 8);
    }
    const tag = this.scene.add
      .text(avatarX, avatarY + 18 + pillHeight / 2, "地主", {
        ...TABLE_TEXT_STYLE,
        fontSize: "11px",
        fontStyle: "900",
        color: TABLE_INK
      })
      .setOrigin(0.5);
    return [crown, pill, tag];
  }

  private addCardBackStack(x: number, y: number, count: number): void {
    if (count <= 0) {
      return;
    }

    const visibleCards = Math.min(20, count);
    const overlapOffset = 11;
    const startX = x - ((visibleCards - 1) * overlapOffset) / 2;
    for (let index = 0; index < visibleCards; index += 1) {
      const cardBack = this.scene.add.image(startX + index * overlapOffset, y, "card-back").setDisplaySize(36, 50);
      this.layer.add(cardBack);
    }

    const countText = this.scene.add
      .text(x, y, `${count}`, {
        ...TABLE_TEXT_STYLE,
        fontSize: "17px",
        fontStyle: "900",
        color: "#ffffff",
        stroke: TABLE_INK,
        strokeThickness: 4
      })
      .setOrigin(0.5);
    this.layer.add(countText);
  }

  private addRevealedHand(x: number, y: number, cards: readonly CardDto[]): void {
    if (cards.length === 0) {
      return;
    }

    const visibleCards = cards.slice(0, 20);
    const gap = 16;
    const startX = x - ((visibleCards.length - 1) * gap) / 2;
    visibleCards.forEach((card, index) => {
      const cardFace = createCardFace(this.scene, startX + index * gap, y, formatCard(card), isRed(card), {
        fontSize: "10px",
        width: 32,
        height: 46
      });
      this.layer.add(cardFace);
    });
  }
}

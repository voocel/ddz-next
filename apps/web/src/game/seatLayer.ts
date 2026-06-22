import type Phaser from "phaser";
import type { CardDto, GameSnapshotDto, RoundReplayDto } from "@ddz/protocol";
import { avatarIndexes, type ThemeId } from "../theme";
import { createCardFace, formatCard, isRed } from "./cardFace";
import { formatActor, formatScore } from "./tablePresentation";
import { seatPositionFor, TABLE_INK, TABLE_INK_SOFT, TABLE_TEXT_STYLE, type StagePoint } from "./tableStage";

export class SeatLayer {
  private readonly layer: Phaser.GameObjects.Container;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly theme: ThemeId,
    private readonly localPlayerId: string
  ) {
    this.layer = scene.add.container(0, 0);
  }

  clear(): void {
    this.layer.removeAll(true);
  }

  renderSnapshot(snapshot: GameSnapshotDto, revealedHands: ReadonlyMap<string, readonly CardDto[]>): void {
    this.clear();
    const localSeat = snapshot.players.find((player) => player.id === this.localPlayerId)?.seat ?? null;
    const showReady = snapshot.phase === "waiting" || snapshot.phase === "ready";
    const indexes = avatarIndexes(snapshot.players.map((player) => player.id));

    snapshot.players.forEach((player, seatIndex) => {
      const position = seatPositionFor(player.seat, localSeat);
      const isLocal = player.id === this.localPlayerId;
      const active = snapshot.currentPlayerId === player.id;
      const plate = this.createSeatPlate(position, active);
      const avatar = this.createSeatAvatar(position, indexes[seatIndex] ?? 1);
      const landlord = snapshot.landlordId === player.id ? " 👑地主" : "";
      const label = this.scene.add.text(
        position.x - 42,
        position.y - 28,
        `${formatActor(player.id, this.localPlayerId, player.nickname)}${landlord}`,
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
        const revealed = snapshot.phase === "settled" ? revealedHands.get(player.id) : undefined;
        if (revealed) {
          this.addRevealedHand(position.x, position.y + 70, revealed);
        } else {
          this.addCardBackStack(position.x, position.y + 67, player.handCount);
        }
      }

      this.layer.add([plate, avatar, label, meta]);
    });
  }

  renderReplay(replay: RoundReplayDto): void {
    this.clear();
    const localSeat = replay.players.find((player) => player.playerId === this.localPlayerId)?.seat ?? null;
    const indexes = avatarIndexes(replay.players.map((player) => player.playerId));

    replay.players.forEach((player, seatIndex) => {
      const position = seatPositionFor(player.seat, localSeat);
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
        `分 ${player.score}  流水 ${formatScore(player.coinDelta)}`,
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

  findSnapshotPosition(snapshot: GameSnapshotDto | null, playerId: string): StagePoint | null {
    const players = snapshot?.players;
    const player = players?.find((item) => item.id === playerId);
    if (!player) {
      return null;
    }

    const localSeat = players?.find((item) => item.id === this.localPlayerId)?.seat ?? null;
    return seatPositionFor(player.seat, localSeat);
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

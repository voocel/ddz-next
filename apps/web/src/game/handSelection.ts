import Phaser from "phaser";
import type { CardId } from "@ddz/domain";

export interface RenderedHandCard {
  readonly id: CardId;
  readonly bounds: Phaser.Geom.Rectangle;
}

interface DragState {
  readonly pointerId: number;
  readonly mode: "add" | "remove";
  readonly touched: Set<CardId>;
}

/**
 * 一次 pointer 交互对场景的副作用诉求：选牌状态机只管「pointer → 选择集」的机制，
 * 把重绘/选牌音效/清反馈交回场景执行，从而与 Phaser 渲染、音频解耦。
 */
export interface HandDragResult {
  readonly render: boolean;
  readonly clearFeedback: boolean;
  readonly playSelect: boolean;
}

const NO_EFFECT: HandDragResult = { render: false, clearFeedback: false, playSelect: false };

/**
 * 手牌选择状态机：拥有已选集合、拖拽过程态与手牌命中区。
 * 手牌横向重叠，命中统一走世界坐标矩形判定（见 setRendered 登记的 bounds），
 * 避开 Phaser 重叠 Container 命中区被整体错位一张的问题。
 */
export class HandSelection {
  private readonly selected = new Set<CardId>();
  private rendered: RenderedHandCard[] = [];
  private drag: DragState | null = null;

  has(id: CardId): boolean {
    return this.selected.has(id);
  }

  /** 供 validateSelectedPlay / describeSelectedCards 只读消费 */
  ids(): ReadonlySet<CardId> {
    return this.selected;
  }

  clear(): void {
    this.selected.clear();
  }

  /** 用一组牌替换当前选择（提示出牌：先清空再选中建议牌） */
  select(ids: Iterable<CardId>): void {
    this.selected.clear();
    for (const id of ids) {
      this.selected.add(id);
    }
  }

  /** 手牌变动后剔除已不在手中的已选牌 */
  prune(handIds: ReadonlySet<CardId>): void {
    for (const id of this.selected) {
      if (!handIds.has(id)) {
        this.selected.delete(id);
      }
    }
  }

  /** renderHand 重绘后登记各手牌的世界坐标命中区 */
  setRendered(cards: RenderedHandCard[]): void {
    this.rendered = cards;
  }

  /** pointerdown：命中牌则起一段增删拖拽（首张即时计入，渲染留待 finish）；点空白处取消全部已选 */
  beginDrag(pointer: Phaser.Input.Pointer, replayMode: boolean): HandDragResult {
    if (replayMode) {
      return NO_EFFECT;
    }

    const cardId = this.findRendered(pointer.worldX, pointer.worldY);
    if (!cardId) {
      // 点击手牌区域外：取消全部已选
      if (this.selected.size > 0) {
        this.selected.clear();
        return { render: true, clearFeedback: true, playSelect: false };
      }
      return NO_EFFECT;
    }

    const mode = this.selected.has(cardId) ? "remove" : "add";
    this.drag = {
      pointerId: pointer.id,
      mode,
      touched: new Set<CardId>()
    };
    this.applyDrag(cardId);
    return NO_EFFECT;
  }

  /** pointermove：沿途按起始模式增删划过的牌（过程中不渲染，渲染在 finish） */
  moveDrag(pointer: Phaser.Input.Pointer): void {
    if (!this.drag || this.drag.pointerId !== pointer.id) {
      return;
    }

    const cardId = this.findRendered(pointer.worldX, pointer.worldY);
    if (cardId) {
      this.applyDrag(cardId);
    }
  }

  /** pointerup：结束拖拽，若期间确有改动则提示场景重绘并播放选牌音 */
  finishDrag(pointer: Phaser.Input.Pointer): HandDragResult {
    if (!this.drag || this.drag.pointerId !== pointer.id) {
      return NO_EFFECT;
    }

    const touched = this.drag.touched.size;
    this.drag = null;
    if (touched > 0) {
      return { render: true, clearFeedback: false, playSelect: true };
    }
    return NO_EFFECT;
  }

  private applyDrag(cardId: CardId): void {
    const drag = this.drag;
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

  private findRendered(x: number, y: number): CardId | null {
    for (let index = this.rendered.length - 1; index >= 0; index -= 1) {
      const card = this.rendered[index];
      if (card && Phaser.Geom.Rectangle.Contains(card.bounds, x, y)) {
        return card.id;
      }
    }

    return null;
  }
}

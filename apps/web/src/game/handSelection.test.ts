import { describe, expect, it, vi } from "vitest";
import type { CardId } from "@ddz/domain";
import { HandSelection, type RenderedHandCard } from "./handSelection";

vi.mock("phaser", () => ({
  default: {
    Geom: {
      Rectangle: {
        Contains(rect: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean {
          return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
        }
      }
    }
  }
}));

describe("HandSelection", () => {
  it("requests redraw while dragging across cards", () => {
    const selection = new HandSelection();
    selection.setRendered([
      card("3-clubs", 0),
      card("4-clubs", 20)
    ]);

    expect(selection.beginDrag(pointer(1, 5, 5), false)).toMatchObject({
      render: true,
      clearFeedback: true,
      playSelect: true
    });
    expect(selection.has("3-clubs")).toBe(true);

    expect(selection.moveDrag(pointer(1, 25, 5))).toMatchObject({
      render: true,
      playSelect: true
    });
    expect(selection.has("4-clubs")).toBe(true);

    expect(selection.finishDrag(pointer(1, 25, 5))).toMatchObject({
      render: false,
      playSelect: false
    });
  });
});

function card(id: CardId, x: number): RenderedHandCard {
  return {
    id,
    bounds: { x, y: 0, width: 18, height: 20 }
  } as RenderedHandCard;
}

function pointer(id: number, worldX: number, worldY: number): Phaser.Input.Pointer {
  return { id, worldX, worldY } as Phaser.Input.Pointer;
}

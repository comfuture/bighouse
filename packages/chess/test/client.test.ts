// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createChessGame } from "../src/client";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("chess client accessibility", () => {
  it("keeps keyboard focus on the selected square after the board rerenders", () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const game = createChessGame(container, {
      playerId: "white",
      version: 1,
      serverTime: Date.now(),
      publicView: {
        roomPhase: "active",
        fen: "4k3/8/8/8/8/8/P7/4K3 w - - 0 1",
        board: [[
          { square: "a2", type: "p", color: "w" },
          { square: "e1", type: "k", color: "w" },
          { square: "e8", type: "k", color: "b" }
        ]],
        currentPlayerId: "white",
        turn: "w",
        moveCount: 0,
        history: [],
        check: false
      },
      privateView: { color: "white" },
      sendAction: vi.fn(),
      requestPlayAgain: vi.fn(),
      leaveFinishedGame: vi.fn()
    });
    const originalCell = container.querySelector<HTMLButtonElement>('[data-square="a2"]')!;
    originalCell.focus();

    originalCell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));

    const renderedCell = container.querySelector<HTMLButtonElement>('[data-square="a2"]')!;
    expect(renderedCell).not.toBe(originalCell);
    expect(document.activeElement).toBe(renderedCell);
    game.destroy();
  });
});

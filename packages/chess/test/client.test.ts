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
      opponentName: "Black",
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

describe("chess client clock", () => {
  it("keeps counting down when the host repeats the last snapshot for a chat update", () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const clock = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const container = document.createElement("div");
    document.body.append(container);
    const view = {
      playerId: "white",
      version: 1,
      serverTime: 50_000,
      opponentName: "Black",
      publicView: {
        roomPhase: "active" as const,
        fen: "4k3/8/8/8/8/8/P7/4K3 w - - 0 1",
        board: [[]],
        currentPlayerId: "white",
        turn: "w" as const,
        clocks: { white: 600_000, black: 600_000 },
        activeClockStartedAt: 50_000,
        moveCount: 0,
        history: [],
        check: false
      },
      privateView: { color: "white" as const }
    };
    const game = createChessGame(container, {
      ...view,
      sendAction: vi.fn(),
      requestPlayAgain: vi.fn(),
      leaveFinishedGame: vi.fn()
    });
    const whiteTime = () => container.querySelector("[data-role='clock-white-time']")!.textContent;
    expect(whiteTime()).toBe("10:00");

    // Two minutes pass, then a chat message makes the host call update() with the same snapshot.
    clock.mockReturnValue(121_000);
    game.update(view);
    expect(whiteTime()).toBe("8:00");
    game.destroy();
    clock.mockRestore();
  });
});

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChessAudioManager } from "../src/audio";
import { createChessGame } from "../src/client";
import { ChessFxRenderer } from "../src/renderer";

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

describe("chess client rematch result effects", () => {
  it("resets result deduplication on rematch so repeated winner/result triggers audio and victory VFX again", () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const playSfxSpy = vi.spyOn(ChessAudioManager.prototype, "playSfx");
    const victorySpy = vi.spyOn(ChessFxRenderer.prototype, "triggerVictoryCelebration");
    const container = document.createElement("div");
    document.body.append(container);

    const activeSnapshot = (version: number) => ({
      playerId: "white",
      version,
      serverTime: 10_000 + version * 1_000,
      opponentName: "Black",
      publicView: {
        roomPhase: "active" as const,
        fen: "4k3/8/8/8/8/8/P7/4K3 w - - 0 1",
        board: [[]],
        currentPlayerId: "white",
        turn: "w" as const,
        moveCount: 0,
        history: [],
        check: false
      },
      privateView: { color: "white" as const }
    });

    const finishedSnapshot = (version: number) => ({
      ...activeSnapshot(version),
      publicView: {
        ...activeSnapshot(version).publicView,
        roomPhase: "finished" as const,
        winnerPlayerId: "white",
        result: "checkmate" as const
      }
    });

    const game = createChessGame(container, {
      ...activeSnapshot(1),
      sendAction: vi.fn(),
      requestPlayAgain: vi.fn(),
      leaveFinishedGame: vi.fn()
    });

    // Game 1 ends in checkmate for white.
    game.update(finishedSnapshot(2));
    expect(playSfxSpy.mock.calls.filter(([key]) => key === "sfx_win")).toHaveLength(1);
    expect(victorySpy).toHaveBeenCalledTimes(1);

    // Follow-up finished snapshot (e.g. rematch request) does not replay end-of-game FX.
    game.update(finishedSnapshot(3));
    expect(playSfxSpy.mock.calls.filter(([key]) => key === "sfx_win")).toHaveLength(1);
    expect(victorySpy).toHaveBeenCalledTimes(1);

    // Rematch begins on the reused mounted client.
    game.update(activeSnapshot(4));

    // Rematch ends with the exact same winner and result.
    game.update(finishedSnapshot(5));
    expect(playSfxSpy.mock.calls.filter(([key]) => key === "sfx_win")).toHaveLength(2);
    expect(victorySpy).toHaveBeenCalledTimes(2);

    game.destroy();
  });
});

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { CHESS_MUTE_STORAGE_KEY, ChessAudioManager } from "../src/audio";
import { createChessGame } from "../src/client";

afterEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ChessAudioManager", () => {
  it("persists mute toggle state in localStorage across instances", () => {
    const first = new ChessAudioManager();
    expect(first.muted).toBe(false);

    expect(first.toggleMute()).toBe(true);
    expect(window.localStorage.getItem(CHESS_MUTE_STORAGE_KEY)).toBe("1");

    const second = new ChessAudioManager();
    expect(second.muted).toBe(true);

    expect(second.toggleMute()).toBe(false);
    expect(window.localStorage.getItem(CHESS_MUTE_STORAGE_KEY)).toBe("0");

    first.destroy();
    second.destroy();
  });

  it("degrades safely in headless environments without AudioContext", async () => {
    const originalAudioContext = (window as unknown as { AudioContext?: unknown }).AudioContext;
    const originalWebkit = (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
    (window as unknown as { AudioContext?: unknown }).AudioContext = undefined;
    (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext = undefined;

    try {
      const manager = new ChessAudioManager();
      await expect(manager.unlock()).resolves.toBeUndefined();
      expect(() => manager.playBgm("bgm_chess")).not.toThrow();
      expect(() => manager.playSfx("sfx_move")).not.toThrow();
      expect(() => manager.playSfx("sfx_capture")).not.toThrow();
      expect(() => manager.playSfx("sfx_check")).not.toThrow();
      expect(() => manager.toggleMute()).not.toThrow();
      expect(() => manager.destroy()).not.toThrow();
    } finally {
      (window as unknown as { AudioContext?: unknown }).AudioContext = originalAudioContext;
      (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext = originalWebkit;
    }
  });

  it("wires the header mute button and sprite/canvas overlay inside createChessGame", () => {
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

    const muteBtn = container.querySelector<HTMLButtonElement>("[data-role='mute-toggle']");
    expect(muteBtn).toBeTruthy();
    expect(muteBtn!.textContent).toBe("🔊 사운드");
    expect(container.querySelector("canvas.chess-fx-canvas")).toBeTruthy();
    expect(container.querySelector('[data-square="a2"] .chess-piece-sprite[data-piece="wp"]')).toBeTruthy();

    muteBtn!.click();
    expect(muteBtn!.textContent).toBe("🔇 음소거");
    expect(window.localStorage.getItem(CHESS_MUTE_STORAGE_KEY)).toBe("1");

    game.destroy();
  });
});

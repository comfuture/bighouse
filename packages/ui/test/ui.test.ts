import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameClientActions, GameClientChatMessage, GameClientSnapshot } from "@bighouse/game-sdk/client";
import {
  BighouseGameChatElement,
  BighouseGameModalElement,
  BighouseGameResultDialogElement,
  BighouseRoomControlsElement,
  createGameUi,
  registerBighouseUi
} from "../src";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("@bighouse/ui", () => {
  it("registers custom elements idempotently", () => {
    expect(() => {
      registerBighouseUi();
      registerBighouseUi();
    }).not.toThrow();
    expect(customElements.get("bighouse-room-controls")).toBe(BighouseRoomControlsElement);
    expect(customElements.get("bighouse-game-chat")).toBe(BighouseGameChatElement);
  });

  it("derives waiting controls and emits composed commands without interpolating player markup", () => {
    registerBighouseUi();
    const controls = document.createElement("bighouse-room-controls") as BighouseRoomControlsElement;
    document.body.append(controls);
    controls.snapshot = snapshot({ displayName: "<img src=x onerror=alert(1)>" });
    const root = controls.shadowRoot!;
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
    const start = [...root.querySelectorAll("button")].find((button) => button.textContent === "Start game")!;
    expect(start.disabled).toBe(false);
    const listener = vi.fn();
    document.body.addEventListener("bighouse-start-game", listener);
    start.click();
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0]?.[0] as CustomEvent).composed).toBe(true);
  });

  it("separates lobby utilities and batches bot players through the settings panel", () => {
    registerBighouseUi();
    const controls = document.createElement("bighouse-room-controls") as BighouseRoomControlsElement;
    document.body.append(controls);
    const initial = snapshot();
    controls.snapshot = {
      ...initial,
      room: {
        ...initial.room,
        maxPlayers: 5,
        players: [
          ...initial.room.players,
          { playerId: "bot_1", displayName: "Bot 1", seat: 2, connected: true, ready: true, joinedAt: 3, kind: "bot", botDifficulty: "medium" }
        ]
      }
    };
    const root = controls.shadowRoot!;
    const share = root.querySelector<HTMLButtonElement>("[aria-label='Share room']")!;
    const leave = root.querySelector<HTMLButtonElement>("[aria-label='Leave']")!;
    const remove = root.querySelector<HTMLButtonElement>("[aria-label='Remove Bot 1 from room']")!;
    expect(share.closest(".bh-room-navigation")).not.toBeNull();
    expect(leave.closest(".bh-room-navigation")).not.toBeNull();
    expect(leave.textContent).toContain("Leave");
    expect(remove.textContent).not.toContain("Remove");
    expect(remove.querySelector("svg")).not.toBeNull();
    expect(root.querySelector(".bh-start-game")).not.toBeNull();

    const listener = vi.fn();
    controls.addEventListener("bighouse-add-bot", listener);
    root.querySelector<HTMLButtonElement>(".bh-add-bots-trigger")!.click();
    const difficulty = root.querySelector<HTMLSelectElement>("[aria-label='Bot difficulty']")!;
    const count = root.querySelector<HTMLSelectElement>("[aria-label='Bot player count']")!;
    expect([...count.options].map((option) => option.value)).toEqual(["1", "2"]);
    difficulty.value = "high";
    difficulty.dispatchEvent(new Event("change", { bubbles: true }));
    count.value = "2";
    count.dispatchEvent(new Event("change", { bubbles: true }));
    expect(root.querySelector<HTMLButtonElement>(".bh-confirm-bots")?.textContent).toBe("Add 2 bot players");
    root.querySelector<HTMLFormElement>(".bh-bot-panel")!.requestSubmit();

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ difficulty: "high", count: 2 });
    expect((listener.mock.calls[0]?.[0] as CustomEvent).composed).toBe(true);
  });

  it("hides the bot count selector when exactly one player slot remains", () => {
    registerBighouseUi();
    const controls = document.createElement("bighouse-room-controls") as BighouseRoomControlsElement;
    document.body.append(controls);
    const initial = snapshot();
    controls.snapshot = { ...initial, room: { ...initial.room, maxPlayers: initial.room.players.length + 1 } };
    controls.shadowRoot!.querySelector<HTMLButtonElement>(".bh-add-bots-trigger")!.click();
    expect(controls.shadowRoot!.querySelector("[aria-label='Bot player count']")).toBeNull();
    expect(controls.shadowRoot!.querySelector<HTMLButtonElement>(".bh-confirm-bots")?.textContent).toBe("Add bot player");
  });

  it("opens chat with desktop Enter, focuses the input, sends once, and closes with Escape", async () => {
    registerBighouseUi();
    const chat = document.createElement("bighouse-game-chat") as BighouseGameChatElement;
    document.body.append(chat);
    const sent = vi.fn();
    chat.addEventListener("bighouse-chat-send", sent);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect(chat.open).toBe(true);
    const input = chat.shadowRoot!.querySelector("input")!;
    expect(chat.shadowRoot!.activeElement).toBe(input);
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    chat.messages = [{
      scope: "room",
      visibility: "public",
      playerId: "guest",
      displayName: "Guest",
      body: "incoming",
      createdAt: 1
    }];
    await Promise.resolve();
    const updatedInput = chat.shadowRoot!.querySelector("input")!;
    expect(updatedInput).toBe(input);
    expect(updatedInput.value).toBe("hello");
    expect(updatedInput.selectionStart).toBe(2);
    expect(chat.shadowRoot!.activeElement).toBe(updatedInput);
    chat.shadowRoot!.querySelector("form")!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: chat.shadowRoot!.querySelector("button") }));
    expect(sent).not.toHaveBeenCalled();
    updatedInput.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    chat.shadowRoot!.querySelector("form")!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: chat.shadowRoot!.querySelector("button") }));
    expect(sent).toHaveBeenCalledOnce();
    updatedInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(chat.open).toBe(false);
  });

  it("dismisses the expanded composer with a visible close control", async () => {
    registerBighouseUi();
    const chat = document.createElement("bighouse-game-chat") as BighouseGameChatElement;
    document.body.append(chat);
    chat.open = true;
    await Promise.resolve();
    const close = chat.shadowRoot!.querySelector<HTMLButtonElement>("[aria-label='Close chat']");
    expect(close).not.toBeNull();
    const input = chat.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    input.value = "unfinished";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    close!.click();
    expect(chat.open).toBe(false);
    chat.open = true;
    await Promise.resolve();
    expect(chat.shadowRoot!.querySelector<HTMLInputElement>("input")?.value).toBe("unfinished");
  });

  it("keeps chess moves out of chat and does not refocus during game-only updates", async () => {
    const host = document.createElement("div");
    const gameControl = document.createElement("button");
    gameControl.textContent = "Game control";
    host.append(gameControl);
    document.body.append(host);
    const initial = {
      ...snapshot(),
      phase: "active" as const,
      publicView: { history: [] }
    };
    const ui = createGameUi(host, initial, actionSpies());
    const chat = host.querySelector("bighouse-game-chat") as BighouseGameChatElement;
    chat.open = true;
    await Promise.resolve();
    const originalInput = chat.shadowRoot!.querySelector("input");
    gameControl.focus();

    ui.update({
      ...initial,
      version: 2,
      uiRevision: 2,
      publicView: { history: ["e4"] }
    });
    await Promise.resolve();

    expect(chat.shadowRoot!.querySelector("input")).toBe(originalInput);
    expect(document.activeElement).toBe(gameControl);
    expect(chat.shadowRoot!.querySelector("[role='log']")?.textContent).not.toContain("e4");
    expect(chat.shadowRoot!.querySelector("[role='log']")?.textContent).not.toContain("Moves");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(chat.shadowRoot!.activeElement).toBe(originalInput);
    ui.destroy();
  });

  it("does not extend chat visibility for duplicate snapshots", async () => {
    vi.useFakeTimers();
    registerBighouseUi();
    const chat = document.createElement("bighouse-game-chat") as BighouseGameChatElement;
    document.body.append(chat);
    chat.messages = chatHistory(1, 0);

    await vi.advanceTimersByTimeAsync(59_000);
    chat.messages = chatHistory(1, 0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(chat.shadowRoot!.querySelector(".bh-chat")?.classList.contains("is-fading")).toBe(true);
  });

  it("defers inactivity dismissal while text composition is active", async () => {
    vi.useFakeTimers();
    registerBighouseUi();
    const chat = document.createElement("bighouse-game-chat") as BighouseGameChatElement;
    document.body.append(chat);
    chat.open = true;
    await Promise.resolve();
    const input = chat.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(chat.open).toBe(true);
    expect(chat.shadowRoot!.querySelector(".bh-chat")?.classList.contains("is-fading")).toBe(false);

    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(chat.shadowRoot!.querySelector(".bh-chat")?.classList.contains("is-fading")).toBe(true);
  });

  it("resets inactivity on receive and input, then fades away after one minute", async () => {
    vi.useFakeTimers();
    registerBighouseUi();
    const chat = document.createElement("bighouse-game-chat") as BighouseGameChatElement;
    const gameControl = document.createElement("button");
    gameControl.textContent = "Game control";
    document.body.append(chat, gameControl);
    chat.messages = chatHistory(1, 0);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(chat.shadowRoot!.querySelector(".bh-chat")?.classList.contains("is-fading")).toBe(false);

    chat.messages = chatHistory(2, 0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(chat.shadowRoot!.querySelector(".bh-chat")?.classList.contains("is-fading")).toBe(false);

    chat.open = true;
    await Promise.resolve();
    const input = chat.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    input.value = "draft";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(chat.open).toBe(true);
    expect(chat.shadowRoot!.querySelector(".bh-chat")?.classList.contains("is-fading")).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(chat.shadowRoot!.querySelector(".bh-chat")?.classList.contains("is-fading")).toBe(true);

    chat.messages = chatHistory(3, 0);
    expect(chat.shadowRoot!.querySelector(".bh-chat")?.classList.contains("is-fading")).toBe(false);
    await vi.advanceTimersByTimeAsync(280);
    expect(chat.open).toBe(true);
    expect(chat.shadowRoot!.querySelector(".bh-chat")?.classList.contains("is-visible")).toBe(true);

    gameControl.focus();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(chat.shadowRoot!.querySelector(".bh-chat")?.classList.contains("is-fading")).toBe(true);
    await vi.advanceTimersByTimeAsync(280);
    expect(chat.open).toBe(false);
    expect(chat.shadowRoot!.querySelector(".bh-chat")?.classList.contains("is-visible")).toBe(false);
    expect(document.activeElement).toBe(gameControl);

    chat.open = true;
    await Promise.resolve();
    expect(chat.shadowRoot!.querySelector<HTMLInputElement>("input")?.value).toBe("draft");
  });

  it("counts unread messages after capped histories and makes the open log scrollable", () => {
    registerBighouseUi();
    const chat = document.createElement("bighouse-game-chat") as BighouseGameChatElement;
    document.body.append(chat);
    chat.messages = chatHistory(200, 0);
    expect(chat.shadowRoot!.querySelector(".bh-chat-trigger")?.getAttribute("aria-label")).toBe("Open chat");
    chat.messages = chatHistory(200, 1);
    expect(chat.shadowRoot!.querySelector(".bh-chat-trigger")?.getAttribute("aria-label")).toBe("Open chat, 1 unread");
    chat.messages = chatHistory(200, 2);
    expect(chat.shadowRoot!.querySelector(".bh-chat-trigger")?.getAttribute("aria-label")).toBe("Open chat, 2 unread");
    chat.open = true;
    expect(chat.shadowRoot!.textContent).toContain("overflow-y:auto; pointer-events:auto");
  });

  it("preserves focused actions when open dialogs update", async () => {
    registerBighouseUi();
    const modal = document.createElement("bighouse-game-modal") as BighouseGameModalElement;
    const result = document.createElement("bighouse-game-result-dialog") as BighouseGameResultDialogElement;
    document.body.append(modal, result);

    modal.state = { open: true, title: "Paused", message: "Waiting" };
    await Promise.resolve();
    expect((modal.shadowRoot!.activeElement as HTMLElement | null)?.dataset.dialogAction).toBe("primary");
    modal.shadowRoot!.querySelector<HTMLButtonElement>("[data-dialog-action='secondary']")!.focus();
    modal.state = { open: true, title: "Paused", message: "Still waiting" };
    await Promise.resolve();
    expect((modal.shadowRoot!.activeElement as HTMLElement | null)?.dataset.dialogAction).toBe("secondary");

    result.state = { open: true, title: "Victory", message: "Round complete" };
    await Promise.resolve();
    expect((result.shadowRoot!.activeElement as HTMLElement | null)?.dataset.dialogAction).toBe("primary");
    result.state = { open: true, title: "Victory", message: "Rematch requested" };
    await Promise.resolve();
    expect((result.shadowRoot!.activeElement as HTMLElement | null)?.dataset.dialogAction).toBe("primary");
  });

  it("wires the controller and cleans up mounted elements", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const actions = actionSpies();
    const ui = createGameUi(host, snapshot(), actions);
    expect(host.querySelector("bighouse-room-controls")).not.toBeNull();
    const chat = host.querySelector("bighouse-game-chat") as BighouseGameChatElement;
    chat.dispatchEvent(new CustomEvent("bighouse-chat-send", { detail: { body: "hi" }, bubbles: true, composed: true }));
    expect(actions.sendChat).toHaveBeenCalledWith("hi", undefined);
    host.querySelector("bighouse-room-controls")!.dispatchEvent(new CustomEvent("bighouse-add-bot", {
      detail: { difficulty: "high", count: 2 },
      bubbles: true,
      composed: true
    }));
    expect(actions.addBot).toHaveBeenCalledWith("high", 2);
    ui.setResult({ open: true, title: "Victory", message: "Round complete" });
    ui.destroy();
    expect(host.children).toHaveLength(0);
  });
});

function snapshot(overrides?: { displayName?: string }): GameClientSnapshot {
  return {
    playerId: "host",
    version: 1,
    uiRevision: 1,
    serverTime: 1,
    phase: "waiting",
    room: {
      roomId: "room_test",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 4,
      hostPlayerId: "host",
      players: [
        { playerId: "host", displayName: overrides?.displayName ?? "Host", seat: 0, connected: true, ready: false, joinedAt: 1 },
        { playerId: "guest", displayName: "Guest", seat: 1, connected: true, ready: true, joinedAt: 2 }
      ]
    },
    publicView: {},
    privateView: {},
    rematchRequests: [],
    chatMessages: []
  };
}

function actionSpies() {
  const actions = {
    sendAction: vi.fn(),
    setReady: vi.fn(),
    startGame: vi.fn(),
    restartGame: vi.fn(),
    addBot: vi.fn(),
    removeBot: vi.fn(),
    transferHost: vi.fn(),
    sendChat: vi.fn(),
    shareRoom: vi.fn(),
    leaveRoom: vi.fn(),
    requestPlayAgain: vi.fn(),
    leaveFinishedGame: vi.fn()
  };
  return actions as typeof actions & GameClientActions;
}

function chatHistory(count: number, offset: number): GameClientChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message_${index + offset}`,
    scope: "room",
    visibility: "public",
    playerId: "guest",
    displayName: "Guest",
    body: `Message ${index + offset}`,
    createdAt: index + offset
  }));
}

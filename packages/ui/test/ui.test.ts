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
    expect(updatedInput.value).toBe("hello");
    expect(chat.shadowRoot!.activeElement).toBe(updatedInput);
    updatedInput.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    chat.shadowRoot!.querySelector("form")!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: chat.shadowRoot!.querySelector("button") }));
    expect(sent).not.toHaveBeenCalled();
    updatedInput.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    chat.shadowRoot!.querySelector("form")!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: chat.shadowRoot!.querySelector("button") }));
    expect(sent).toHaveBeenCalledOnce();
    updatedInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(chat.open).toBe(false);
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

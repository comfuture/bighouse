import type { GameClientActions, GameClientSnapshot } from "@bighouse/game-sdk/client";
import {
  BighouseGameChatElement,
  BighouseGameModalElement,
  BighouseGameResultDialogElement,
  BighouseRoomControlsElement,
  type GameModalState,
  type GameResultDialogState
} from "./components";
import { registerBighouseUi } from "./register";

export {
  BighouseGameChatElement,
  BighouseGameModalElement,
  BighouseGameResultDialogElement,
  BighouseRoomControlsElement,
  registerBighouseUi
};
export type { GameModalState, GameResultDialogState };

export type MountedGameUi = {
  update(snapshot: GameClientSnapshot): void;
  setResult(state: GameResultDialogState): void;
  setNotice(state: GameModalState): void;
  destroy(): void;
};

export function createGameUi(container: HTMLElement, snapshot: GameClientSnapshot, actions: GameClientActions): MountedGameUi {
  registerBighouseUi();
  const computedPosition = getComputedStyle(container).position;
  const previousPosition = container.style.position;
  if (computedPosition === "static") container.style.position = "relative";

  const roomControls = document.createElement("bighouse-room-controls") as BighouseRoomControlsElement;
  const chat = document.createElement("bighouse-game-chat") as BighouseGameChatElement;
  const result = document.createElement("bighouse-game-result-dialog") as BighouseGameResultDialogElement;
  const notice = document.createElement("bighouse-game-modal") as BighouseGameModalElement;
  container.append(roomControls, chat, result, notice);

  const listeners: Array<[HTMLElement, string, EventListener]> = [];
  const listen = (target: HTMLElement, name: string, listener: EventListener): void => {
    target.addEventListener(name, listener);
    listeners.push([target, name, listener]);
  };
  listen(roomControls, "bighouse-ready-change", ((event: CustomEvent<{ ready: boolean }>) => actions.setReady(event.detail.ready)) as EventListener);
  listen(roomControls, "bighouse-start-game", (() => actions.startGame()) as EventListener);
  listen(roomControls, "bighouse-restart-game", (() => actions.restartGame()) as EventListener);
  listen(roomControls, "bighouse-add-bot", ((event: CustomEvent<{ difficulty: "low" | "medium" | "high"; count: number }>) => {
    actions.addBot(event.detail.difficulty, event.detail.count);
  }) as EventListener);
  listen(roomControls, "bighouse-remove-bot", ((event: CustomEvent<{ botPlayerId: string }>) => actions.removeBot(event.detail.botPlayerId)) as EventListener);
  listen(roomControls, "bighouse-transfer-host", ((event: CustomEvent<{ targetPlayerId: string }>) => actions.transferHost(event.detail.targetPlayerId)) as EventListener);
  listen(roomControls, "bighouse-share-room", (() => actions.shareRoom()) as EventListener);
  listen(roomControls, "bighouse-leave-room", (() => actions.leaveRoom()) as EventListener);
  listen(chat, "bighouse-chat-send", ((event: CustomEvent<{ body: string; targetPlayerId?: string }>) => actions.sendChat(event.detail.body, event.detail.targetPlayerId)) as EventListener);
  listen(result, "bighouse-rematch", (() => actions.requestPlayAgain()) as EventListener);
  listen(result, "bighouse-leave-finished", (() => actions.leaveFinishedGame()) as EventListener);

  const update = (next: GameClientSnapshot): void => {
    roomControls.snapshot = next;
    chat.messages = next.chatMessages;
  };
  update(snapshot);

  return {
    update,
    setResult(state) { result.state = state; },
    setNotice(state) { notice.state = state; },
    destroy() {
      listeners.forEach(([target, name, listener]) => target.removeEventListener(name, listener));
      roomControls.remove();
      chat.remove();
      result.remove();
      notice.remove();
      container.style.position = previousPosition;
    }
  };
}

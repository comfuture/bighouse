import {
  BighouseGameChatElement,
  BighouseGameControlsElement,
  BighouseGameModalElement,
  BighouseGameResultDialogElement,
  BighouseRoomControlsElement
} from "./components";

const definitions = [
  ["bighouse-room-controls", BighouseRoomControlsElement],
  ["bighouse-game-controls", BighouseGameControlsElement],
  ["bighouse-game-chat", BighouseGameChatElement],
  ["bighouse-game-modal", BighouseGameModalElement],
  ["bighouse-game-result-dialog", BighouseGameResultDialogElement]
] as const;

export function registerBighouseUi(): void {
  for (const [name, definition] of definitions) {
    if (!customElements.get(name)) customElements.define(name, definition);
  }
}

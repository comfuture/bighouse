import type {
  BotDifficulty,
  GameClientChatMessage,
  GameClientRoom,
  GameClientSnapshot,
  PlayerSeat
} from "@bighouse/game-sdk/client";
import { iconMarkup } from "./icons";
import { baseStyles, chatStyles, modalStyles, roomStyles } from "./styles";

export type GameResultDialogState = {
  open: boolean;
  title: string;
  message: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  primaryDisabled?: boolean;
  kicker?: string;
};

export type GameModalState = GameResultDialogState & {
  dismissible?: boolean;
};

const commonStyles = `<style>${baseStyles}</style>`;

export class BighouseRoomControlsElement extends HTMLElement {
  readonly #root = this.attachShadow({ mode: "open" });
  #snapshot: GameClientSnapshot | undefined;

  set snapshot(value: GameClientSnapshot | undefined) {
    this.#snapshot = value;
    this.render();
  }

  get snapshot(): GameClientSnapshot | undefined {
    return this.#snapshot;
  }

  connectedCallback(): void {
    this.render();
  }

  private render(): void {
    const snapshot = this.#snapshot;
    if (!snapshot) {
      this.#root.replaceChildren();
      return;
    }

    const { room, playerId, phase } = snapshot;
    const isWaiting = phase === "waiting";
    const interruption = room.activeInterruption;
    const showLobby = isWaiting || Boolean(interruption);
    const isHost = room.hostPlayerId === playerId;
    const me = room.players.find((player) => player.playerId === playerId);
    const canManageBots = isHost && (isWaiting || Boolean(interruption));
    const canStart = isHost && isWaiting && room.players.length >= room.minPlayers && room.players
      .filter((player) => player.playerId !== room.hostPlayerId && !isBot(player))
      .every((player) => player.connected && player.ready);
    const canRestart = isHost && Boolean(interruption) && room.players.length >= room.minPlayers;

    this.#root.innerHTML = `${commonStyles}<style>${roomStyles}</style>`;
    const root = element("section", `bh-room${showLobby ? "" : " is-rail"}`);
    root.setAttribute("part", showLobby ? "waiting-overlay" : "room-rail");
    const panel = element("div", "bh-room-panel");

    if (showLobby) {
      const heading = element("header", "bh-room-heading");
      const headingCopy = element("div");
      headingCopy.append(textElement("div", "bh-room-kicker", interruption ? "Game interrupted" : "Ready room"));
      headingCopy.append(textElement("h2", "", interruption ? "Reset the table?" : "Players at the table"));
      heading.append(headingCopy, textElement("div", "bh-capacity", `${room.players.length}/${room.maxPlayers}`));
      panel.append(heading);

      if (interruption) {
        const person = interruption.displayName || interruption.playerId;
        panel.append(textElement(
          "div",
          "bh-interruption",
          isHost
            ? `${person} left. Start again from a fresh game state when enough players are ready.`
            : `${person} left. The host is deciding when to restart.`
        ));
      } else {
        panel.append(textElement(
          "p",
          "bh-room-copy",
          isHost ? "Add players or bots, then launch the game." : "Mark yourself ready while the host prepares the table."
        ));
      }

      const list = element("ol", "bh-player-list");
      room.players.forEach((player) => list.append(this.renderPlayer(player, room, canManageBots)));
      panel.append(list);

      const footer = element("footer", "bh-room-footer");
      const actions = element("div", "bh-actions");
      if (!isHost && isWaiting && !isBot(me)) {
        actions.append(commandButton(me?.ready ? "Cancel ready" : "Ready", "is-primary", () => {
          emit(this, "bighouse-ready-change", { ready: !me?.ready });
        }));
      }
      if (isHost && isWaiting) {
        const start = commandButton("Start game", "is-primary", () => emit(this, "bighouse-start-game"));
        start.disabled = !canStart;
        actions.append(start);
      }
      if (interruption && isHost) {
        const restart = commandButton("Start fresh game", "is-primary", () => emit(this, "bighouse-restart-game"));
        restart.disabled = !canRestart;
        actions.append(restart);
      }
      actions.append(commandButton("Share", "is-quiet", () => emit(this, "bighouse-share-room")));
      actions.append(commandButton("Leave", "is-danger", () => emit(this, "bighouse-leave-room")));
      footer.append(actions);

      if (canManageBots) {
        const botControls = element("div", "bh-bot-controls");
        const label = textElement("label", "", "Bot difficulty");
        const select = document.createElement("select");
        select.setAttribute("aria-label", "Bot difficulty");
        (["low", "medium", "high"] satisfies BotDifficulty[]).forEach((difficulty) => {
          const option = document.createElement("option");
          option.value = difficulty;
          option.textContent = difficulty[0]!.toUpperCase() + difficulty.slice(1);
          if (difficulty === "medium") option.selected = true;
          select.append(option);
        });
        label.append(select);
        const add = commandButton("Add bot", "", () => {
          emit(this, "bighouse-add-bot", { difficulty: select.value as BotDifficulty });
        });
        add.disabled = room.players.length >= room.maxPlayers;
        botControls.append(label, add);
        footer.append(botControls);
      }
      panel.append(footer);
    } else {
      const rail = element("div", "bh-rail-actions");
      rail.append(commandButton("Leave", "is-danger", () => emit(this, "bighouse-leave-room")));
      panel.append(rail);
    }

    root.append(panel);
    this.#root.append(root);
  }

  private renderPlayer(player: PlayerSeat, room: GameClientRoom, canManageBots: boolean): HTMLLIElement {
    const row = element("li", "bh-player") as HTMLLIElement;
    row.append(textElement("span", "bh-seat", String(player.seat + 1)));
    const identity = element("div");
    identity.append(textElement("div", "bh-player-name", player.displayName || player.playerId));
    const labels = [
      player.playerId === room.hostPlayerId ? "host" : undefined,
      isBot(player) ? `${player.botDifficulty ?? "medium"} bot` : "human"
    ].filter(Boolean).join(" · ");
    identity.append(textElement("div", "bh-player-meta", labels));
    row.append(identity);

    const badges = element("div", "bh-badges");
    if (isBot(player)) {
      badges.append(textElement("span", "bh-badge is-ready", "ready"));
      if (canManageBots) {
        const remove = commandButton("Remove", "bh-remove", () => emit(this, "bighouse-remove-bot", { botPlayerId: player.playerId }));
        remove.className = "bh-remove";
        remove.setAttribute("aria-label", `Remove ${player.displayName || player.playerId}`);
        badges.append(remove);
      }
    } else {
      badges.append(textElement("span", `bh-badge${player.connected ? " is-ready" : " is-offline"}`, player.connected ? "online" : "offline"));
      if (this.#snapshot?.phase === "waiting" && player.playerId !== room.hostPlayerId) {
        badges.append(textElement("span", `bh-badge ${player.ready ? "is-ready" : "is-waiting"}`, player.ready ? "ready" : "not ready"));
      }
      if (canManageBots && player.playerId !== this.#snapshot?.playerId && player.playerId !== room.hostPlayerId) {
        const transfer = commandButton("Make host", "is-quiet", () => emit(this, "bighouse-transfer-host", { targetPlayerId: player.playerId }));
        transfer.style.minHeight = "32px";
        transfer.style.padding = "5px 8px";
        transfer.style.fontSize = "11px";
        badges.append(transfer);
      }
    }
    row.append(badges);
    return row;
  }
}

export class BighouseGameChatElement extends HTMLElement {
  readonly #root = this.attachShadow({ mode: "open" });
  #messages: GameClientChatMessage[] = [];
  #open = false;
  #unread = 0;
  #connectedOnce = false;
  #composing = false;
  #draft = "";
  #previousFocus: HTMLElement | null = null;
  readonly #onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.#open) {
      event.preventDefault();
      this.open = false;
      return;
    }
    if (
      event.key !== "Enter" || this.#open || event.repeat || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || eventHasEditableTarget(event)
    ) return;
    event.preventDefault();
    this.open = true;
  };

  set messages(value: readonly GameClientChatMessage[]) {
    const shouldRestoreInputFocus = this.#root.activeElement instanceof HTMLInputElement;
    const next = [...value].slice(-80);
    if (this.#connectedOnce && !this.#open && next.length > this.#messages.length) {
      this.#unread += next.length - this.#messages.length;
    }
    this.#messages = next;
    this.render();
    if (shouldRestoreInputFocus) queueMicrotask(() => this.focusInput());
  }

  get messages(): readonly GameClientChatMessage[] {
    return this.#messages;
  }

  set open(value: boolean) {
    if (this.#open === value) return;
    this.#open = value;
    if (value) {
      this.#previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.#unread = 0;
    }
    this.render();
    if (value) {
      queueMicrotask(() => this.focusInput());
    } else {
      this.#previousFocus?.focus();
    }
    emit(this, "bighouse-chat-open-change", { open: value });
  }

  get open(): boolean {
    return this.#open;
  }

  connectedCallback(): void {
    document.addEventListener("keydown", this.#onDocumentKeyDown, true);
    this.#connectedOnce = true;
    this.render();
  }

  disconnectedCallback(): void {
    document.removeEventListener("keydown", this.#onDocumentKeyDown, true);
  }

  private render(): void {
    this.#root.innerHTML = `${commonStyles}<style>${chatStyles}</style>`;
    const chat = element("section", `bh-chat${this.#open ? " is-open" : ""}`);
    chat.setAttribute("part", "chat-overlay");
    chat.setAttribute("aria-label", "Game chat");

    const log = element("div", "bh-chat-log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    this.#messages.forEach((message) => {
      const line = element("div", `bh-message${message.visibility === "private" ? " is-private" : ""}`);
      const author = textElement("strong", "", message.displayName || message.playerId);
      const separator = document.createTextNode(message.visibility === "private" ? " [private] · " : " · ");
      line.append(author, separator, document.createTextNode(message.body));
      log.append(line);
    });
    chat.append(log);

    const composer = element("form", "bh-chat-composer") as HTMLFormElement;
    const input = document.createElement("input");
    input.className = "bh-chat-input";
    input.type = "text";
    input.maxLength = 500;
    input.autocomplete = "off";
    input.value = this.#draft;
    input.placeholder = "Message the room";
    input.setAttribute("aria-label", "Game chat message");
    input.addEventListener("input", () => { this.#draft = input.value; });
    input.addEventListener("compositionstart", () => { this.#composing = true; });
    input.addEventListener("compositionend", () => { this.#composing = false; });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.open = false;
      }
    });
    const send = commandButton("", "bh-button bh-chat-send", () => undefined);
    send.className = "bh-button bh-chat-send";
    send.type = "submit";
    send.setAttribute("aria-label", "Send chat message");
    const sendIcon = element("span", "bh-icon");
    sendIcon.innerHTML = iconMarkup("send");
    send.append(sendIcon);
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.#composing) return;
      const body = input.value.trim();
      if (!body) return;
      emit(this, "bighouse-chat-send", { body });
      this.#draft = "";
      input.value = "";
    });
    composer.append(input, send);
    chat.append(composer);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "bh-chat-trigger";
    trigger.setAttribute("aria-label", this.#unread > 0 ? `Open chat, ${this.#unread} unread` : "Open chat");
    const triggerIcon = element("span", "bh-icon");
    triggerIcon.innerHTML = iconMarkup("message-circle");
    trigger.append(triggerIcon);
    if (this.#unread > 0) trigger.append(textElement("span", "bh-unread", String(Math.min(this.#unread, 99))));
    trigger.addEventListener("click", () => { this.open = true; });
    chat.append(trigger);
    this.#root.append(chat);
  }

  private focusInput(): void {
    this.#root.querySelector<HTMLInputElement>("input")?.focus();
  }
}

export class BighouseGameModalElement extends HTMLElement {
  readonly #root = this.attachShadow({ mode: "open" });
  #state: GameModalState = { open: false, title: "", message: "" };
  #previousFocus: HTMLElement | null = null;

  set state(value: GameModalState) {
    const wasOpen = this.#state.open;
    this.#state = value;
    if (!wasOpen && value.open) this.#previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.render();
    if (!wasOpen && value.open) queueMicrotask(() => this.#root.querySelector<HTMLButtonElement>("button")?.focus());
    if (wasOpen && !value.open) this.#previousFocus?.focus();
  }

  get state(): GameModalState { return this.#state; }

  connectedCallback(): void { this.render(); }

  private render(): void {
    const state = this.#state;
    this.#root.innerHTML = `${commonStyles}<style>${modalStyles}</style>`;
    const modal = element("section", `bh-modal${state.open ? " is-open" : ""}`);
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", String(!state.open));
    const panel = element("div", "bh-modal-panel");
    panel.append(textElement("div", "bh-modal-kicker", state.kicker ?? "Game notice"));
    panel.append(textElement("h2", "", state.title));
    panel.append(textElement("p", "", state.message));
    const actions = element("div", "bh-modal-actions");
    const secondary = commandButton(state.secondaryLabel ?? "Cancel", "is-quiet", () => emit(this, "bighouse-modal-secondary"));
    const primary = commandButton(state.primaryLabel ?? "Continue", "is-primary", () => emit(this, "bighouse-modal-primary"));
    primary.disabled = state.primaryDisabled === true;
    actions.append(secondary, primary);
    panel.append(actions);
    modal.append(panel);
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.dismissible !== false) {
        event.preventDefault();
        emit(this, "bighouse-modal-secondary");
      }
    });
    this.#root.append(modal);
  }
}

export class BighouseGameResultDialogElement extends HTMLElement {
  readonly #root = this.attachShadow({ mode: "open" });
  #state: GameResultDialogState = { open: false, title: "", message: "" };
  #previousFocus: HTMLElement | null = null;

  set state(value: GameResultDialogState) {
    const wasOpen = this.#state.open;
    this.#state = value;
    if (!wasOpen && value.open) this.#previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.render();
    if (!wasOpen && value.open) queueMicrotask(() => this.#root.querySelector<HTMLButtonElement>("button")?.focus());
    if (wasOpen && !value.open) this.#previousFocus?.focus();
  }

  get state(): GameResultDialogState { return this.#state; }

  connectedCallback(): void { this.render(); }

  private render(): void {
    const state = this.#state;
    this.#root.innerHTML = `${commonStyles}<style>${modalStyles}</style>`;
    const modal = element("section", `bh-modal${state.open ? " is-open" : ""}`);
    modal.setAttribute("part", "result-dialog");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", String(!state.open));
    const panel = element("div", "bh-modal-panel");
    panel.append(textElement("div", "bh-modal-kicker", state.kicker ?? "Round complete"));
    panel.append(textElement("h2", "", state.title));
    panel.append(textElement("p", "", state.message));
    const actions = element("div", "bh-modal-actions");
    const leave = commandButton(state.secondaryLabel ?? "Leave", "is-quiet", () => emit(this, "bighouse-leave-finished"));
    const rematch = commandButton(state.primaryLabel ?? "Play again", "is-primary", () => emit(this, "bighouse-rematch"));
    rematch.disabled = state.primaryDisabled === true;
    actions.append(leave, rematch);
    panel.append(actions);
    modal.append(panel);
    this.#root.append(modal);
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const node = element(tag, className);
  node.textContent = text;
  return node;
}

function commandButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className.startsWith("bh-") ? className : `bh-button${className ? ` ${className}` : ""}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function emit(target: HTMLElement, name: string, detail?: Record<string, unknown>): void {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

function isBot(player: PlayerSeat | undefined): boolean {
  return Boolean(player && (player.kind === "bot" || player.botDifficulty !== undefined));
}

function eventHasEditableTarget(event: Event): boolean {
  return event.composedPath().some((target) => target instanceof Element && Boolean(
    target.closest("input, textarea, select, button, [contenteditable=''], [contenteditable='true']")
  ));
}

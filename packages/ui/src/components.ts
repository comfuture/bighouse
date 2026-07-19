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
const chatInactivityMs = 60_000;
const chatFadeMs = 280;

export class BighouseRoomControlsElement extends HTMLElement {
  readonly #root = this.attachShadow({ mode: "open" });
  #snapshot: GameClientSnapshot | undefined;
  #botPanelOpen = false;
  #botDifficulty: BotDifficulty = "medium";
  #botCount = 1;

  set snapshot(value: GameClientSnapshot | undefined) {
    this.#snapshot = value;
    const remainingSlots = value ? Math.max(0, value.room.maxPlayers - value.room.players.length) : 0;
    this.#botCount = Math.max(1, Math.min(this.#botCount, remainingSlots || 1));
    if (remainingSlots === 0) this.#botPanelOpen = false;
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
    const remainingSlots = Math.max(0, room.maxPlayers - room.players.length);
    if (!canManageBots) this.#botPanelOpen = false;
    const canStart = isHost && isWaiting && room.players.length >= room.minPlayers && room.players
      .filter((player) => player.playerId !== room.hostPlayerId && !isBot(player))
      .every((player) => player.connected && player.ready);
    const canRestart = isHost && Boolean(interruption) && room.players.length >= room.minPlayers;

    this.#root.innerHTML = `${commonStyles}<style>${roomStyles}</style>`;
    const root = element("section", `bh-room${showLobby ? "" : " is-rail"}`);
    root.setAttribute("part", showLobby ? "waiting-overlay" : "room-rail");
    const panel = element("div", "bh-room-panel");

    if (showLobby) {
      const navigation = element("div", "bh-room-navigation");
      navigation.append(
        iconTextButton("log-out", "Leave", "bh-room-leave", () => emit(this, "bighouse-leave-room")),
        iconButton("share-2", "Share room", "bh-room-share", () => emit(this, "bighouse-share-room"))
      );
      panel.append(navigation);

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
      const actions = element("div", "bh-primary-actions");
      if (!isHost && isWaiting && !isBot(me)) {
        actions.append(commandButton(me?.ready ? "Cancel ready" : "Ready", "is-primary", () => {
          emit(this, "bighouse-ready-change", { ready: !me?.ready });
        }));
      }
      if (isHost && isWaiting) {
        const start = commandButton("Start game", "is-primary bh-start-game", () => emit(this, "bighouse-start-game"));
        start.disabled = !canStart;
        actions.append(start);
      }
      if (interruption && isHost) {
        const restart = commandButton("Start fresh game", "is-primary bh-start-game", () => emit(this, "bighouse-restart-game"));
        restart.disabled = !canRestart;
        actions.append(restart);
      }
      if (actions.childElementCount > 0) footer.append(actions);

      if (canManageBots && remainingSlots > 0) footer.append(this.renderBotManager(remainingSlots));
      if (footer.childElementCount > 0) panel.append(footer);
    } else {
      const rail = element("div", "bh-rail-actions");
      rail.append(iconTextButton("log-out", "Leave", "bh-room-leave is-compact", () => emit(this, "bighouse-leave-room")));
      panel.append(rail);
    }

    root.append(panel);
    this.#root.append(root);
  }

  private renderBotManager(remainingSlots: number): HTMLElement {
    const manager = element("div", "bh-bot-manager");
    const launcher = iconTextButton("bot", "Add Bot Players", "bh-add-bots-trigger", () => {
      this.#botPanelOpen = !this.#botPanelOpen;
      this.render();
      if (this.#botPanelOpen) queueMicrotask(() => this.#root.querySelector<HTMLSelectElement>("[aria-label='Bot difficulty']")?.focus());
    });
    launcher.setAttribute("aria-expanded", String(this.#botPanelOpen));
    launcher.setAttribute("aria-controls", "bh-bot-panel");
    manager.append(launcher);

    if (!this.#botPanelOpen) return manager;

    const panel = element("form", "bh-bot-panel") as HTMLFormElement;
    panel.id = "bh-bot-panel";
    panel.setAttribute("aria-label", "Add bot players");
    const panelHeader = element("header", "bh-bot-panel-heading");
    const panelTitle = element("div");
    panelTitle.append(
      textElement("strong", "", "Add Bot Players"),
      textElement("span", "", `${remainingSlots} ${remainingSlots === 1 ? "slot" : "slots"} remaining`)
    );
    panelHeader.append(panelTitle, iconButton("x", "Close bot settings", "bh-bot-panel-close", () => {
      this.#botPanelOpen = false;
      this.render();
      queueMicrotask(() => this.#root.querySelector<HTMLButtonElement>(".bh-add-bots-trigger")?.focus());
    }));
    panel.append(panelHeader);

    const fields = element("div", "bh-bot-fields");
    const difficultyLabel = textElement("label", "", "Difficulty");
    const difficultySelect = document.createElement("select");
    difficultySelect.setAttribute("aria-label", "Bot difficulty");
    (["low", "medium", "high"] satisfies BotDifficulty[]).forEach((difficulty) => {
      const option = document.createElement("option");
      option.value = difficulty;
      option.textContent = difficulty[0]!.toUpperCase() + difficulty.slice(1);
      option.selected = difficulty === this.#botDifficulty;
      difficultySelect.append(option);
    });
    difficultySelect.addEventListener("change", () => { this.#botDifficulty = difficultySelect.value as BotDifficulty; });
    difficultyLabel.append(difficultySelect);
    fields.append(difficultyLabel);

    if (remainingSlots > 1) {
      const countLabel = textElement("label", "", "Players");
      const countSelect = document.createElement("select");
      countSelect.setAttribute("aria-label", "Bot player count");
      for (let count = 1; count <= remainingSlots; count += 1) {
        const option = document.createElement("option");
        option.value = String(count);
        option.textContent = String(count);
        option.selected = count === this.#botCount;
        countSelect.append(option);
      }
      countSelect.addEventListener("change", () => { this.#botCount = Number(countSelect.value); });
      countSelect.addEventListener("change", () => {
        const confirm = panel.querySelector<HTMLButtonElement>(".bh-confirm-bots");
        if (confirm) confirm.textContent = botAddLabel(this.#botCount);
      });
      countLabel.append(countSelect);
      fields.append(countLabel);
    }
    panel.append(fields);

    const add = commandButton(
      botAddLabel(this.#botCount),
      "is-primary bh-confirm-bots",
      () => undefined
    );
    add.type = "submit";
    panel.append(add);
    panel.addEventListener("submit", (event) => {
      event.preventDefault();
      const count = remainingSlots === 1 ? 1 : Math.max(1, Math.min(this.#botCount, remainingSlots));
      emit(this, "bighouse-add-bot", { difficulty: this.#botDifficulty, count });
      this.#botPanelOpen = false;
      this.#botCount = 1;
      this.render();
      queueMicrotask(() => {
        const nextControl = this.#root.querySelector<HTMLButtonElement>(".bh-start-game")
          ?? this.#root.querySelector<HTMLButtonElement>(".bh-add-bots-trigger");
        nextControl?.focus();
      });
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.#botPanelOpen = false;
      this.render();
      queueMicrotask(() => this.#root.querySelector<HTMLButtonElement>(".bh-add-bots-trigger")?.focus());
    });
    manager.prepend(panel);
    return manager;
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
        const displayName = player.displayName || player.playerId;
        const remove = iconButton("user-x", `Remove ${displayName} from room`, "bh-remove", () => {
          emit(this, "bighouse-remove-bot", { botPlayerId: player.playerId });
        });
        remove.title = "Remove player";
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
  #messagesInitialized = false;
  #composing = false;
  #draft = "";
  #visible = false;
  #logScrollTop = 0;
  #followLatest = true;
  #hideTimer: ReturnType<typeof setTimeout> | undefined;
  #fadeTimer: ReturnType<typeof setTimeout> | undefined;
  #previousFocus: HTMLElement | null = null;
  readonly #onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.#open) {
      event.preventDefault();
      this.open = false;
      return;
    }
    if (
      event.key !== "Enter" || event.repeat || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || eventHasEditableTarget(event)
    ) return;
    event.preventDefault();
    if (this.#open) {
      this.noteActivity();
      this.focusInput();
    } else {
      this.open = true;
    }
  };

  set messages(value: readonly GameClientChatMessage[]) {
    const incoming = [...value];
    const next = incoming.slice(-80);
    if (this.#messagesInitialized && sameMessages(this.#messages, next)) return;
    const appendedCount = this.#messagesInitialized ? countAppendedMessages(this.#messages, incoming) : 0;
    if (this.#connectedOnce && this.#messagesInitialized && !this.#open) {
      this.#unread += appendedCount;
    }
    this.#messages = next;
    if ((!this.#messagesInitialized && next.length > 0) || appendedCount > 0) this.noteActivity();
    this.#messagesInitialized = true;
    if (this.#root.querySelector(".bh-chat")) {
      this.renderMessages();
      this.updateChatState();
    } else {
      this.render();
    }
  }

  get messages(): readonly GameClientChatMessage[] {
    return this.#messages;
  }

  set open(value: boolean) {
    if (this.#open === value) return;
    this.#open = value;
    if (value) {
      const activeElement = document.activeElement;
      const shadowFocused = shadowActiveElement(this.#root);
      this.#previousFocus = shadowFocused instanceof HTMLElement
        ? shadowFocused
        : activeElement instanceof HTMLElement && activeElement !== this ? activeElement : null;
      this.#unread = 0;
      this.noteActivity();
    }
    if (this.#root.querySelector(".bh-chat")) this.updateChatState();
    else this.render();
    if (value) {
      queueMicrotask(() => this.focusInput());
    } else {
      this.restorePreviousFocus();
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
    if (this.#visible) this.noteActivity();
  }

  disconnectedCallback(): void {
    document.removeEventListener("keydown", this.#onDocumentKeyDown, true);
    this.clearActivityTimers();
  }

  private render(): void {
    this.#root.innerHTML = `${commonStyles}<style>${chatStyles}</style>`;
    const chat = element("section", ["bh-chat", this.#open ? "is-open" : "", this.#visible ? "is-visible" : ""].filter(Boolean).join(" "));
    chat.setAttribute("part", "chat-overlay");
    chat.setAttribute("aria-label", "Game chat");

    const log = element("div", "bh-chat-log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    log.addEventListener("scroll", () => {
      this.#logScrollTop = log.scrollTop;
      this.#followLatest = log.scrollHeight - log.clientHeight - log.scrollTop < 24;
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
    input.addEventListener("input", () => {
      this.#draft = input.value;
      this.noteActivity();
    });
    input.addEventListener("compositionstart", () => {
      this.#composing = true;
      this.noteActivity();
    });
    input.addEventListener("compositionend", () => {
      this.#composing = false;
      this.noteActivity();
    });
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
      this.noteActivity();
      this.#draft = "";
      input.value = "";
    });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "bh-chat-close";
    close.setAttribute("aria-label", "Close chat");
    const closeIcon = element("span", "bh-icon");
    closeIcon.innerHTML = iconMarkup("x");
    close.append(closeIcon);
    close.addEventListener("click", () => { this.open = false; });
    composer.toggleAttribute("inert", !this.#open);
    composer.append(input, send, close);
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
    this.updateChatState();
    this.renderMessages();
  }

  private renderMessages(): void {
    const log = this.#root.querySelector<HTMLElement>(".bh-chat-log");
    if (!log) return;
    log.replaceChildren();
    this.#messages.forEach((message) => {
      const line = element("div", `bh-message${message.visibility === "private" ? " is-private" : ""}`);
      const author = textElement("strong", "", message.displayName || message.playerId);
      const separator = document.createTextNode(message.visibility === "private" ? " [private] · " : " · ");
      line.append(author, separator, document.createTextNode(message.body));
      log.append(line);
    });
    queueMicrotask(() => {
      log.scrollTop = this.#followLatest ? log.scrollHeight : this.#logScrollTop;
    });
  }

  private updateChatState(): void {
    const chat = this.#root.querySelector<HTMLElement>(".bh-chat");
    if (!chat) return;
    chat.classList.toggle("is-open", this.#open);
    chat.classList.toggle("is-visible", this.#visible);
    const composer = chat.querySelector<HTMLFormElement>(".bh-chat-composer");
    composer?.toggleAttribute("inert", !this.#open);
    const trigger = chat.querySelector<HTMLButtonElement>(".bh-chat-trigger");
    if (!trigger) return;
    trigger.setAttribute("aria-label", this.#unread > 0 ? `Open chat, ${this.#unread} unread` : "Open chat");
    trigger.querySelector(".bh-unread")?.remove();
    if (this.#unread > 0) trigger.append(textElement("span", "bh-unread", String(Math.min(this.#unread, 99))));
  }

  private focusInput(): void {
    if (this.#open) this.#root.querySelector<HTMLInputElement>("input")?.focus();
  }

  private noteActivity(): void {
    this.#visible = true;
    if (this.#fadeTimer !== undefined) {
      clearTimeout(this.#fadeTimer);
      this.#fadeTimer = undefined;
    }
    this.#root.querySelector(".bh-chat")?.classList.remove("is-fading");
    this.updateChatState();
    if (this.#hideTimer !== undefined) clearTimeout(this.#hideTimer);
    if (this.isConnected) {
      this.#hideTimer = setTimeout(() => this.beginFade(), chatInactivityMs);
    }
  }

  private beginFade(): void {
    this.#hideTimer = undefined;
    if (this.#composing) {
      this.noteActivity();
      return;
    }
    const chat = this.#root.querySelector(".bh-chat");
    if (!chat) {
      this.finishAutoHide();
      return;
    }
    chat.classList.add("is-fading");
    this.#fadeTimer = setTimeout(() => this.finishAutoHide(), prefersReducedMotion() ? 0 : chatFadeMs);
  }

  private finishAutoHide(): void {
    this.#fadeTimer = undefined;
    const wasOpen = this.#open;
    this.#open = false;
    this.#visible = false;
    this.updateChatState();
    if (wasOpen) {
      this.restorePreviousFocus();
      emit(this, "bighouse-chat-open-change", { open: false });
    }
  }

  private clearActivityTimers(): void {
    if (this.#hideTimer !== undefined) clearTimeout(this.#hideTimer);
    if (this.#fadeTimer !== undefined) clearTimeout(this.#fadeTimer);
    this.#hideTimer = undefined;
    this.#fadeTimer = undefined;
  }

  private restorePreviousFocus(): void {
    const focusIsInsideChat = document.activeElement === this || shadowActiveElement(this.#root) !== null;
    if (focusIsInsideChat) {
      const target = this.#previousFocus?.isConnected
        ? this.#previousFocus
        : this.#root.querySelector<HTMLButtonElement>(".bh-chat-trigger");
      target?.focus();
    }
    this.#previousFocus = null;
  }
}

export class BighouseGameModalElement extends HTMLElement {
  readonly #root = this.attachShadow({ mode: "open" });
  #state: GameModalState = { open: false, title: "", message: "" };
  #previousFocus: HTMLElement | null = null;

  set state(value: GameModalState) {
    const wasOpen = this.#state.open;
    const focusedRole = focusedDialogAction(this.#root);
    this.#state = value;
    if (!wasOpen && value.open) this.#previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.render();
    if (value.open && (!wasOpen || focusedRole)) {
      queueMicrotask(() => focusDialogAction(this.#root, focusedRole ?? "primary"));
    }
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
    secondary.dataset.dialogAction = "secondary";
    primary.dataset.dialogAction = "primary";
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
    const focusedRole = focusedDialogAction(this.#root);
    this.#state = value;
    if (!wasOpen && value.open) this.#previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.render();
    if (value.open && (!wasOpen || focusedRole)) {
      queueMicrotask(() => focusDialogAction(this.#root, focusedRole ?? "primary"));
    }
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
    leave.dataset.dialogAction = "secondary";
    rematch.dataset.dialogAction = "primary";
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

function iconButton(name: Parameters<typeof iconMarkup>[0], label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `bh-icon-command ${className}`;
  button.setAttribute("aria-label", label);
  const icon = element("span", "bh-icon");
  icon.innerHTML = iconMarkup(name);
  button.append(icon);
  button.addEventListener("click", onClick);
  return button;
}

function iconTextButton(name: Parameters<typeof iconMarkup>[0], label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = iconButton(name, label, className, onClick);
  button.append(textElement("span", "bh-command-label", label));
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

function countAppendedMessages(previous: readonly GameClientChatMessage[], incoming: readonly GameClientChatMessage[]): number {
  const lastPrevious = previous.at(-1);
  if (!lastPrevious) return incoming.length;
  const lastIdentity = messageIdentity(lastPrevious);
  for (let index = incoming.length - 1; index >= 0; index -= 1) {
    const message = incoming[index];
    if (message && messageIdentity(message) === lastIdentity) return incoming.length - index - 1;
  }
  return incoming.length;
}

function sameMessages(previous: readonly GameClientChatMessage[], next: readonly GameClientChatMessage[]): boolean {
  return previous.length === next.length && previous.every((message, index) => {
    const candidate = next[index];
    return Boolean(candidate && messageRenderIdentity(message) === messageRenderIdentity(candidate));
  });
}

function messageIdentity(message: GameClientChatMessage): string {
  return message.id
    ? `id:${message.id}`
    : [message.createdAt, message.playerId, message.targetPlayerId ?? "", message.visibility, message.body].join("\u0000");
}

function messageRenderIdentity(message: GameClientChatMessage): string {
  return [
    messageIdentity(message),
    message.displayName ?? "",
    message.scope,
    message.scopeId ?? "",
    message.visibility,
    message.body
  ].join("\u0000");
}

type DialogAction = "primary" | "secondary";

function focusedDialogAction(root: ShadowRoot): DialogAction | undefined {
  const focused = shadowActiveElement(root);
  const role = focused instanceof HTMLButtonElement ? focused.dataset.dialogAction : undefined;
  return role === "primary" || role === "secondary" ? role : undefined;
}

function focusDialogAction(root: ShadowRoot, role: DialogAction): void {
  root.querySelector<HTMLButtonElement>(`[data-dialog-action='${role}']`)?.focus();
}

function shadowActiveElement(root: ShadowRoot): Element | null {
  try {
    return root.activeElement;
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function botAddLabel(count: number): string {
  return count === 1 ? "Add bot player" : `Add ${count} bot players`;
}

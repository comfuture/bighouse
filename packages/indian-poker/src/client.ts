import "./style.css";
import type { GameClientContext, MountedGameClient } from "@bighouse/game-sdk/client";
import { triggerCardSubmitFeedback, triggerSelectionFeedback } from "@bighouse/game-sdk/feedback";
export { gameMetadata } from "./client-metadata";

// ─── View Types ──────────────────────────────────────────────────────────────

export type IndianPokerPhase = "idle" | "betting" | "reveal" | "gameOver";

export type IndianPokerActionName = "bet" | "check" | "call" | "raise" | "double" | "die" | "nextRound";

export type IndianPokerRoundResultView = {
  round: number;
  reason: "showdown" | "fold";
  cards: Record<string, string>;
  winnerPlayerId?: string;
  isTie: boolean;
  pot: number;
  foldedPlayerId?: string;
  chipDelta: Record<string, number>;
};

export type IndianPokerPublicView = {
  roomPhase?: "waiting" | "active" | "finished" | "closed";
  phase: IndianPokerPhase;
  round: number;
  pot: number;
  ante: number;
  startingChips: number;
  currentBet: number;
  chips: Record<string, number>;
  bets: Record<string, number>;
  toCall: Record<string, number>;
  currentPlayerId?: string;
  lastAggressorPlayerId?: string;
  raiseCount: number;
  maxRaises: number;
  availableActions: IndianPokerActionName[];
  nextRoundRequests: string[];
  deckCount: number;
  revealed: boolean;
  roundResult?: IndianPokerRoundResultView;
  cards?: Record<string, string>;
  winnerPlayerId?: string;
  rematchRequests?: string[];
};

export type IndianPokerPrivateView = {
  seat: number;
  opponentPlayerId?: string;
  /** The card on the opponent's forehead, which is the only card you may read. */
  opponentCard: string | null;
  /** `"hidden"` until the round opens, then the player's actual card. */
  myCard: string | null | "hidden";
  myCardRevealed: boolean;
  availableActions: IndianPokerActionName[];
};

export type IndianPokerClient = {
  playerId: string;
  publicView: IndianPokerPublicView;
  privateView: IndianPokerPrivateView;
  version: number;
  sendAction(action: { type: string; payload: Record<string, unknown> }): void;
  requestPlayAgain(): void;
  leaveFinishedGame(): void;
};

export type IndianPokerGameInstance = {
  update(input: Omit<IndianPokerClient, "sendAction" | "requestPlayAgain" | "leaveFinishedGame">): void;
  destroy(): void;
};

// ─── Card Rendering ──────────────────────────────────────────────────────────

const SUIT_SYMBOLS: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const SUIT_NAMES: Record<string, string> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
const TOAST_MS = 2_200;

function isRedSuit(suit: string): boolean {
  return suit === "H" || suit === "D";
}

function describeCard(card: string): string {
  const suit = card.slice(-1);
  return `${card.slice(0, -1)} of ${SUIT_NAMES[suit] ?? suit}`;
}

/**
 * A forehead card. `card === null` renders the face-down back, which is what a
 * player sees of their own card before the round opens.
 */
function renderCard(card: string | null, label: string): string {
  if (!card) {
    return `
      <div class="ip-card is-face-down" role="img" aria-label="${label}: face down">
        <span class="ip-card-back-mark">BH</span>
      </div>
    `;
  }
  const suit = card.slice(-1);
  const rank = card.slice(0, -1);
  const symbol = SUIT_SYMBOLS[suit] ?? suit;
  return `
    <div class="ip-card ${isRedSuit(suit) ? "is-red" : "is-black"}" role="img" aria-label="${label}: ${describeCard(card)}">
      <span class="ip-card-rank">${rank}</span>
      <span class="ip-card-suit">${symbol}</span>
    </div>
  `;
}

/** Head-and-shoulders silhouette used for both seats. */
function silhouetteSvg(): string {
  return `
    <svg class="ip-figure" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
      <circle class="ip-figure-head" cx="60" cy="34" r="26" />
      <path class="ip-figure-body" d="M8 100c0-26 23-38 52-38s52 12 52 38z" />
    </svg>
  `;
}

// ─── Mount ───────────────────────────────────────────────────────────────────

export function mountGame(container: HTMLElement, context: GameClientContext): MountedGameClient {
  const instance = createIndianPokerGame(container, toIndianPokerClient(context));
  return {
    update(nextContext) {
      instance.update(toIndianPokerClient({ ...context, ...nextContext }));
    },
    destroy() {
      instance.destroy();
    }
  };
}

function toIndianPokerClient(context: GameClientContext): IndianPokerClient {
  return {
    playerId: context.playerId,
    version: context.version,
    publicView: {
      ...(context.publicView as IndianPokerPublicView),
      roomPhase: context.phase,
      rematchRequests: context.rematchRequests
    },
    privateView: context.privateView as IndianPokerPrivateView,
    sendAction: context.sendAction,
    requestPlayAgain: context.requestPlayAgain,
    leaveFinishedGame: context.leaveFinishedGame
  };
}

export function createIndianPokerGame(container: HTMLElement, client: IndianPokerClient): IndianPokerGameInstance {
  const state = { ...client };
  let previousPublicView: IndianPokerPublicView | null = null;
  /** Chips staked by the bet/raise sizer. Kept local so renders do not reset it. */
  let wager = 0;
  let toast: string | null = null;
  let toastTimer: number | undefined;

  container.classList.add("indian-poker-game");
  container.innerHTML = `
    <div class="ip-table">
      <section class="ip-seat is-opponent" data-role="opponent-seat">
        <div class="ip-seat-figure">
          ${silhouetteSvg()}
          <div class="ip-forehead" data-role="opponent-card"></div>
        </div>
        <div class="ip-seat-meta">
          <span class="ip-seat-name" data-role="opponent-name">Opponent</span>
          <span class="ip-seat-chips" data-role="opponent-chips"></span>
          <span class="ip-seat-wager" data-role="opponent-wager"></span>
        </div>
      </section>

      <section class="ip-pot-zone">
        <div class="ip-round-label" data-role="round-label"></div>
        <div class="ip-pot">
          <span class="ip-pot-label">POT</span>
          <span class="ip-pot-amount" data-role="pot-amount">0</span>
        </div>
        <div class="ip-toast is-hidden" data-role="toast" aria-live="polite"></div>
      </section>

      <section class="ip-seat is-self" data-role="self-seat">
        <div class="ip-self-row">
          <div class="ip-seat-figure">
            ${silhouetteSvg()}
            <div class="ip-forehead" data-role="my-card"></div>
          </div>
          <div class="ip-seat-meta">
            <span class="ip-seat-name">You</span>
            <span class="ip-seat-chips" data-role="my-chips"></span>
            <span class="ip-seat-wager" data-role="my-wager"></span>
          </div>
        </div>

        <div class="ip-controls">
          <p class="ip-status" data-role="status" aria-live="polite"></p>

          <div class="ip-sizer is-hidden" data-role="sizer">
            <button type="button" class="ip-step" data-role="wager-down" aria-label="Lower the stake">&minus;</button>
            <label class="ip-sizer-track">
              <span class="ip-sizer-caption" data-role="sizer-caption">Stake</span>
              <input
                type="range"
                class="ip-slider"
                data-role="wager-slider"
                min="1"
                max="1"
                step="1"
                value="1"
                aria-label="Stake amount"
              />
            </label>
            <button type="button" class="ip-step" data-role="wager-up" aria-label="Raise the stake">+</button>
            <output class="ip-sizer-value" data-role="wager-value">0</output>
          </div>

          <div class="ip-quick is-hidden" data-role="quick"></div>

          <div class="ip-actions" data-role="actions">
            <button type="button" class="ip-action is-check" data-role="action-check">Check</button>
            <button type="button" class="ip-action is-primary" data-role="action-bet">Bet</button>
            <button type="button" class="ip-action is-primary" data-role="action-call">Call</button>
            <button type="button" class="ip-action is-double" data-role="action-double">Double</button>
            <button type="button" class="ip-action is-raise" data-role="action-raise">Raise</button>
            <button type="button" class="ip-action is-die" data-role="action-die">Die</button>
          </div>
        </div>
      </section>

      <div class="ip-reveal is-hidden" data-role="reveal" role="dialog" aria-modal="false" aria-label="Round result">
        <div class="ip-reveal-panel">
          <p class="ip-reveal-title" data-role="reveal-title"></p>
          <div class="ip-reveal-cards">
            <div class="ip-reveal-hand">
              <span class="ip-reveal-owner">Opponent</span>
              <div data-role="reveal-opponent-card"></div>
              <span class="ip-reveal-delta" data-role="reveal-opponent-delta"></span>
            </div>
            <span class="ip-reveal-versus" data-role="reveal-versus">vs</span>
            <div class="ip-reveal-hand">
              <span class="ip-reveal-owner">You</span>
              <div data-role="reveal-my-card"></div>
              <span class="ip-reveal-delta" data-role="reveal-my-delta"></span>
            </div>
          </div>
          <p class="ip-reveal-message" data-role="reveal-message"></p>
          <button type="button" class="ip-action is-primary ip-reveal-next" data-role="action-next-round">
            Next Round
          </button>
        </div>
      </div>

      <div class="ip-result is-hidden" data-role="result" role="dialog" aria-modal="true" aria-label="Match result">
        <div class="ip-result-panel">
          <p class="ip-result-title" data-role="result-title"></p>
          <p class="ip-result-message" data-role="result-message"></p>
          <div class="ip-result-actions">
            <button type="button" class="ip-action is-primary" data-role="play-again">Play Again</button>
            <button type="button" class="ip-action" data-role="leave-game">Leave</button>
          </div>
        </div>
      </div>
    </div>
  `;

  function pick<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = container.querySelector<T>(selector);
    if (!element) throw new Error(`Failed to mount Indian Poker: missing ${selector}`);
    return element;
  }

  const dom = {
    opponentSeat: pick("[data-role='opponent-seat']"),
    opponentCard: pick("[data-role='opponent-card']"),
    opponentName: pick("[data-role='opponent-name']"),
    opponentChips: pick("[data-role='opponent-chips']"),
    opponentWager: pick("[data-role='opponent-wager']"),
    selfSeat: pick("[data-role='self-seat']"),
    myCard: pick("[data-role='my-card']"),
    myChips: pick("[data-role='my-chips']"),
    myWager: pick("[data-role='my-wager']"),
    roundLabel: pick("[data-role='round-label']"),
    potAmount: pick("[data-role='pot-amount']"),
    toast: pick("[data-role='toast']"),
    status: pick("[data-role='status']"),
    sizer: pick("[data-role='sizer']"),
    sizerCaption: pick("[data-role='sizer-caption']"),
    slider: pick<HTMLInputElement>("[data-role='wager-slider']"),
    wagerDown: pick<HTMLButtonElement>("[data-role='wager-down']"),
    wagerUp: pick<HTMLButtonElement>("[data-role='wager-up']"),
    wagerValue: pick("[data-role='wager-value']"),
    quick: pick("[data-role='quick']"),
    actions: pick("[data-role='actions']"),
    check: pick<HTMLButtonElement>("[data-role='action-check']"),
    bet: pick<HTMLButtonElement>("[data-role='action-bet']"),
    call: pick<HTMLButtonElement>("[data-role='action-call']"),
    double: pick<HTMLButtonElement>("[data-role='action-double']"),
    raise: pick<HTMLButtonElement>("[data-role='action-raise']"),
    die: pick<HTMLButtonElement>("[data-role='action-die']"),
    reveal: pick("[data-role='reveal']"),
    revealTitle: pick("[data-role='reveal-title']"),
    revealOpponentCard: pick("[data-role='reveal-opponent-card']"),
    revealOpponentDelta: pick("[data-role='reveal-opponent-delta']"),
    revealVersus: pick("[data-role='reveal-versus']"),
    revealMyCard: pick("[data-role='reveal-my-card']"),
    revealMyDelta: pick("[data-role='reveal-my-delta']"),
    revealMessage: pick("[data-role='reveal-message']"),
    nextRound: pick<HTMLButtonElement>("[data-role='action-next-round']"),
    result: pick("[data-role='result']"),
    resultTitle: pick("[data-role='result-title']"),
    resultMessage: pick("[data-role='result-message']"),
    playAgain: pick<HTMLButtonElement>("[data-role='play-again']"),
    leave: pick<HTMLButtonElement>("[data-role='leave-game']")
  };

  // ─── Derived Reads ─────────────────────────────────────────────────────────

  function opponentId(): string | undefined {
    return (
      state.privateView.opponentPlayerId ??
      Object.keys(state.publicView.chips ?? {}).find((playerId) => playerId !== state.playerId)
    );
  }

  function isMyTurn(): boolean {
    return state.publicView.roomPhase === "active" && state.publicView.currentPlayerId === state.playerId;
  }

  function myActions(): IndianPokerActionName[] {
    return isMyTurn() ? (state.privateView.availableActions ?? []) : [];
  }

  /** Betting options only; the reveal handshake has its own button. */
  function myBettingActions(): IndianPokerActionName[] {
    return myActions().filter((action) => action !== "nextRound");
  }

  function can(action: IndianPokerActionName): boolean {
    return myActions().includes(action);
  }

  function myChips(): number {
    return state.publicView.chips?.[state.playerId] ?? 0;
  }

  function myToCall(): number {
    return state.publicView.toCall?.[state.playerId] ?? 0;
  }

  /** Highest stake the sizer may offer: a raise also has to cover the call. */
  function maxWager(): number {
    const chips = myChips();
    return myToCall() > 0 ? Math.max(0, chips - myToCall()) : chips;
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  function send(type: IndianPokerActionName, payload: Record<string, unknown> = {}): void {
    triggerCardSubmitFeedback();
    client.sendAction({ type, payload });
  }

  function setWager(next: number): void {
    const limit = maxWager();
    wager = Math.max(Math.min(next, limit), limit > 0 ? 1 : 0);
    renderSizer();
  }

  dom.wagerDown.addEventListener("click", () => {
    triggerSelectionFeedback();
    setWager(wager - stepSize());
  });
  dom.wagerUp.addEventListener("click", () => {
    triggerSelectionFeedback();
    setWager(wager + stepSize());
  });
  dom.slider.addEventListener("input", () => {
    wager = Number(dom.slider.value);
    renderSizer();
  });
  dom.quick.addEventListener("click", (domEvent) => {
    const button = (domEvent.target as HTMLElement).closest<HTMLButtonElement>("[data-wager]");
    if (!button) return;
    triggerSelectionFeedback();
    setWager(Number(button.dataset.wager));
  });

  dom.check.addEventListener("click", () => can("check") && send("check"));
  dom.call.addEventListener("click", () => can("call") && send("call"));
  dom.double.addEventListener("click", () => can("double") && send("double"));
  dom.die.addEventListener("click", () => can("die") && send("die"));
  dom.bet.addEventListener("click", () => can("bet") && wager > 0 && send("bet", { amount: wager }));
  dom.raise.addEventListener("click", () => can("raise") && wager > 0 && send("raise", { amount: wager }));
  dom.nextRound.addEventListener("click", () => {
    if (state.publicView.nextRoundRequests?.includes(state.playerId)) return;
    send("nextRound");
  });

  dom.playAgain.addEventListener("click", () => {
    if (state.publicView.rematchRequests?.includes(state.playerId)) return;
    triggerSelectionFeedback();
    client.requestPlayAgain();
  });
  dom.leave.addEventListener("click", () => {
    triggerSelectionFeedback();
    client.leaveFinishedGame();
  });

  /** One ante is a natural nudge for the stake stepper. */
  function stepSize(): number {
    return Math.max(1, state.publicView.ante ?? 1);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  function render(): void {
    const view = state.publicView;
    const opponent = opponentId();
    const waiting = view.roomPhase !== "active" || view.phase === "idle";

    dom.roundLabel.textContent = waiting
      ? "Waiting for players"
      : `Round ${view.round} · Ante ${view.ante} · Deck ${view.deckCount}`;
    dom.potAmount.textContent = String(view.revealed ? (view.roundResult?.pot ?? 0) : (view.pot ?? 0));

    renderOpponent(opponent, waiting);
    renderSelf(waiting);
    renderStatus(waiting);
    renderSizer();
    renderActionRow();
    renderRevealPanel(opponent);
    renderResultModal();
    renderToast();
  }

  function renderOpponent(opponent: string | undefined, waiting: boolean): void {
    const view = state.publicView;
    dom.opponentSeat.classList.toggle("is-empty", !opponent);
    dom.opponentSeat.classList.toggle("is-turn", Boolean(opponent) && view.currentPlayerId === opponent);
    dom.opponentName.textContent = opponent ? "Opponent" : "Empty seat";
    dom.opponentChips.textContent = opponent ? `${view.chips?.[opponent] ?? 0} chips` : "";

    const opponentBet = opponent ? (view.bets?.[opponent] ?? 0) : 0;
    dom.opponentWager.textContent = opponentBet > 0 && !waiting ? `wagered ${opponentBet}` : "";

    // The opponent's card is readable the whole time: that is the game.
    dom.opponentCard.innerHTML = waiting
      ? ""
      : renderCard(state.privateView.opponentCard ?? null, "Opponent's forehead card");
  }

  function renderSelf(waiting: boolean): void {
    const view = state.publicView;
    const toCall = myToCall();
    dom.selfSeat.classList.toggle("is-turn", isMyTurn());
    dom.myChips.textContent = `${myChips()} chips`;

    const myBet = view.bets?.[state.playerId] ?? 0;
    const parts: string[] = [];
    if (myBet > 0 && !waiting) parts.push(`wagered ${myBet}`);
    if (toCall > 0) parts.push(`to call ${toCall}`);
    dom.myWager.textContent = parts.join(" · ");

    // Your own card stays face down until the round opens, so all you can do is
    // read the other forehead.
    const revealedCard = state.privateView.myCardRevealed ? state.privateView.myCard : null;
    dom.myCard.innerHTML = waiting
      ? ""
      : renderCard(typeof revealedCard === "string" && revealedCard !== "hidden" ? revealedCard : null, "Your forehead card");
  }

  function renderStatus(waiting: boolean): void {
    const view = state.publicView;
    if (waiting) {
      dom.status.textContent = "Waiting for an opponent to sit down.";
      return;
    }
    if (view.phase === "gameOver") {
      dom.status.textContent =
        view.winnerPlayerId === state.playerId ? "You cleaned out the table." : "You are out of chips.";
      return;
    }
    if (view.phase === "reveal") {
      dom.status.textContent = view.nextRoundRequests?.includes(state.playerId)
        ? "Waiting for your opponent to deal again."
        : "Round over. Play another round?";
      return;
    }
    if (!isMyTurn()) {
      dom.status.textContent = "Reading you. Waiting for your opponent to act.";
      return;
    }
    const toCall = myToCall();
    if (toCall <= 0) {
      dom.status.textContent = "Your turn. Check, or open with a bet.";
      return;
    }
    const capped = view.raiseCount >= view.maxRaises;
    dom.status.textContent = capped
      ? `Your turn. Raise cap reached, so call ${toCall} or die.`
      : `Your turn. ${toCall} to call, or read the other forehead and die.`;
  }

  function renderSizer(): void {
    const limit = maxWager();
    const sizing = can("bet") || can("raise");
    dom.sizer.classList.toggle("is-hidden", !sizing || limit <= 0);
    dom.quick.classList.toggle("is-hidden", !sizing || limit <= 0);
    if (!sizing || limit <= 0) {
      dom.quick.innerHTML = "";
      return;
    }

    wager = Math.max(1, Math.min(wager || defaultWager(limit), limit));
    dom.sizerCaption.textContent = can("raise") ? "Raise by" : "Bet";
    dom.slider.max = String(limit);
    dom.slider.value = String(wager);
    dom.wagerDown.disabled = wager <= 1;
    dom.wagerUp.disabled = wager >= limit;
    dom.wagerValue.textContent = String(wager);
    renderQuickWagers(limit);
    // Keep the primary button label in step with the slider.
    dom.bet.textContent = `Bet ${wager}`;
    dom.raise.textContent = `Raise ${wager}`;
  }

  function defaultWager(limit: number): number {
    const view = state.publicView;
    const suggested = Math.max(view.ante ?? 1, Math.round((view.pot ?? 0) / 2));
    return Math.max(1, Math.min(suggested, limit));
  }

  function renderQuickWagers(limit: number): void {
    const view = state.publicView;
    const presets: { label: string; amount: number }[] = [
      { label: "Ante", amount: view.ante ?? 1 },
      { label: "½ Pot", amount: Math.round((view.pot ?? 0) / 2) },
      { label: "Pot", amount: view.pot ?? 0 },
      { label: "All In", amount: limit }
    ];
    const seen = new Set<number>();
    dom.quick.innerHTML = presets
      .map((preset) => ({ ...preset, amount: Math.max(1, Math.min(preset.amount, limit)) }))
      .filter((preset) => {
        if (seen.has(preset.amount)) return false;
        seen.add(preset.amount);
        return true;
      })
      .map(
        (preset) =>
          `<button type="button" class="ip-quick-button${preset.amount === wager ? " is-active" : ""}" data-wager="${preset.amount}">${preset.label}</button>`
      )
      .join("");
  }

  function renderActionRow(): void {
    const toCall = myToCall();
    toggleAction(dom.check, can("check"), "Check");
    toggleAction(dom.bet, can("bet"), `Bet ${wager}`);
    toggleAction(dom.call, can("call"), toCall > 0 ? `Call ${toCall}` : "Call");
    toggleAction(dom.double, can("double"), `Double ${toCall * 2}`);
    toggleAction(dom.raise, can("raise") && maxWager() > 0, `Raise ${wager}`);
    toggleAction(dom.die, can("die"), "Die");
    dom.actions.classList.toggle("is-hidden", myBettingActions().length === 0);
  }

  function toggleAction(button: HTMLButtonElement, enabled: boolean, label: string): void {
    button.classList.toggle("is-hidden", !enabled);
    button.disabled = !enabled;
    button.textContent = label;
  }

  function renderRevealPanel(opponent: string | undefined): void {
    const view = state.publicView;
    const result = view.roundResult;
    // The match-over modal takes over from the per-round panel.
    if (!result || view.phase !== "reveal") {
      dom.reveal.classList.add("is-hidden");
      return;
    }

    const myCard = result.cards[state.playerId] ?? null;
    const opponentCard = opponent ? (result.cards[opponent] ?? null) : null;
    dom.revealMyCard.innerHTML = renderCard(myCard, "Your card");
    dom.revealOpponentCard.innerHTML = renderCard(opponentCard, "Opponent's card");
    dom.revealVersus.textContent = "vs";

    const iWon = result.winnerPlayerId === state.playerId;
    dom.revealTitle.textContent = result.isTie
      ? "Split pot"
      : iWon
        ? `You take ${result.pot}`
        : `Opponent takes ${result.pot}`;
    dom.revealTitle.className = `ip-reveal-title ${result.isTie ? "is-tie" : iWon ? "is-win" : "is-loss"}`;

    dom.revealMyDelta.textContent = formatDelta(result.chipDelta[state.playerId] ?? 0);
    dom.revealOpponentDelta.textContent = opponent ? formatDelta(result.chipDelta[opponent] ?? 0) : "";

    const iRequested = view.nextRoundRequests?.includes(state.playerId) ?? false;
    const opponentRequested = (view.nextRoundRequests ?? []).some((playerId) => playerId !== state.playerId);
    dom.revealMessage.textContent = result.isTie
      ? "Equal ranks, so both wagers come back."
      : result.reason === "fold"
        ? iWon
          ? "Your opponent folded before the cards opened."
          : "You folded. Your chips stay in the pot."
        : iWon
          ? "The higher card wins the pot."
          : "The higher card takes it this time.";

    dom.nextRound.disabled = iRequested;
    dom.nextRound.textContent = iRequested
      ? "Waiting for opponent…"
      : opponentRequested
        ? "Next Round (opponent is ready)"
        : "Next Round";
    dom.reveal.classList.remove("is-hidden");
  }

  function renderResultModal(): void {
    const view = state.publicView;
    if (!view.winnerPlayerId || view.roomPhase !== "finished") {
      dom.result.classList.add("is-hidden");
      dom.playAgain.disabled = false;
      dom.playAgain.textContent = "Play Again";
      return;
    }

    const iWon = view.winnerPlayerId === state.playerId;
    dom.resultTitle.textContent = iWon ? "You Win!" : "You Lose";
    dom.resultTitle.className = `ip-result-title ${iWon ? "is-win" : "is-loss"}`;

    const requested = view.rematchRequests ?? [];
    const iRequested = requested.includes(state.playerId);
    const opponentRequested = requested.some((playerId) => playerId !== state.playerId);
    dom.resultMessage.textContent = iRequested
      ? "Waiting for your opponent…"
      : opponentRequested
        ? `Your opponent wants a rematch. Chips reset to ${view.startingChips}.`
        : `${view.round} rounds played. A rematch resets both stacks to ${view.startingChips}.`;
    dom.playAgain.disabled = iRequested;
    dom.playAgain.textContent = iRequested ? "Waiting…" : "Play Again";
    dom.result.classList.remove("is-hidden");
  }

  function formatDelta(delta: number): string {
    if (delta === 0) return "±0";
    return delta > 0 ? `+${delta}` : String(delta);
  }

  // ─── Toast ─────────────────────────────────────────────────────────────────

  function renderToast(): void {
    dom.toast.classList.toggle("is-hidden", !toast);
    dom.toast.textContent = toast ?? "";
  }

  function showToast(message: string): void {
    toast = message;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = null;
      renderToast();
    }, TOAST_MS);
    renderToast();
  }

  /**
   * The client only receives snapshots, so the last action is inferred from the
   * wager the previous turn holder added.
   */
  function describeTransition(before: IndianPokerPublicView, after: IndianPokerPublicView): string | null {
    const actor = before.currentPlayerId;
    if (!actor || before.phase !== "betting") return null;
    if (after.round !== before.round) return null;

    const who = actor === state.playerId ? "You" : "Opponent";
    const staked = (after.bets?.[actor] ?? 0) - (before.bets?.[actor] ?? 0);
    const owed = before.toCall?.[actor] ?? 0;

    if (after.phase === "reveal") {
      if (after.roundResult?.reason === "fold") return `${who} died`;
      return staked > 0 ? `${who} called ${staked}` : `${who} checked`;
    }
    if (staked <= 0) return `${who} checked`;
    if (owed > 0) return `${who} raised to ${after.bets?.[actor] ?? 0}`;
    return `${who} bet ${staked}`;
  }

  previousPublicView = state.publicView;
  render();

  return {
    update(input) {
      if (state.version === input.version) return;
      const before = previousPublicView;
      state.playerId = input.playerId;
      state.version = input.version;
      state.publicView = input.publicView;
      state.privateView = input.privateView;

      if (before) {
        if (before.round !== state.publicView.round && state.publicView.round > 0) {
          showToast(`Round ${state.publicView.round}: cards on foreheads`);
          wager = 0;
        } else {
          const message = describeTransition(before, state.publicView);
          if (message) showToast(message);
        }
      }
      previousPublicView = state.publicView;
      render();
    },
    destroy() {
      if (toastTimer) window.clearTimeout(toastTimer);
      container.classList.remove("indian-poker-game");
      container.innerHTML = "";
    }
  };
}

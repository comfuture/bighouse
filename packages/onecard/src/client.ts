import "./style.css";
import type { GameClientContext, MountedGameClient } from "@bighouse/game-sdk/client";
import { triggerCardSubmitFeedback, triggerSelectionFeedback } from "@bighouse/game-sdk/feedback";
export { gameMetadata } from "./client-metadata";

export type OneCardPublicView = {
  roomPhase?: "waiting" | "active" | "finished" | "closed";
  discardPile: string[];
  deckCount: number;
  currentPlayerId?: string;
  turnDirection: "clockwise" | "counterclockwise";
  activeAttackCount: number;
  activeAttackCard?: string;
  chosenSuit?: "S" | "H" | "C" | "D";
  winnerPlayerId?: string;
  eliminatedPlayerIds: string[];
  hasExtraTurn: boolean;
  rematchRequests?: string[];
  hands: Record<string, { count: number }>;
};

export type OneCardPrivateView = {
  hand: string[];
};

export type OneCardClient = {
  playerId: string;
  version: number;
  publicView: OneCardPublicView;
  privateView: OneCardPrivateView;
  sendAction(action: { type: string; payload: Record<string, unknown> }): void;
  requestPlayAgain(): void;
  leaveFinishedGame(): void;
};

export type OneCardGameInstance = {
  update(input: Omit<OneCardClient, "sendAction" | "requestPlayAgain" | "leaveFinishedGame">): void;
  destroy(): void;
};

const SUIT_SYMBOLS = {
  S: "♠",
  H: "♥",
  C: "♣",
  D: "♦",
  J: "🃏"
};

const SUIT_NAMES = {
  S: "Spade",
  H: "Heart",
  C: "Club",
  D: "Diamond"
};

type ActionNoticeTone = "play" | "draw" | "attack" | "turn";

type ActionNotice = {
  text: string;
  tone: ActionNoticeTone;
};

type LocalDrawReveal = {
  startIndex: number;
  count: number;
  version: number;
  revealed: boolean;
};

const maxBundleFlyers = 5;
const singleFlightMs = 460;
const bundleFlightMs = 620;
const bundleStaggerMs = 70;
const drawRevealHoldMs = 1_200;

export function mountGame(container: HTMLElement, context: GameClientContext): MountedGameClient {
  const instance = createOneCardGame(container, toOneCardClient(context));
  return {
    update(nextContext) {
      instance.update(toOneCardClient({ ...context, ...nextContext }));
    },
    destroy() {
      instance.destroy();
    }
  };
}

function toOneCardClient(context: GameClientContext): OneCardClient {
  return {
    playerId: context.playerId,
    version: context.version,
    publicView: {
      ...(context.publicView as OneCardPublicView),
      roomPhase: context.phase,
      rematchRequests: context.rematchRequests
    },
    privateView: context.privateView as OneCardPrivateView,
    sendAction: context.sendAction,
    requestPlayAgain: context.requestPlayAgain,
    leaveFinishedGame: context.leaveFinishedGame
  };
}

export function createOneCardGame(container: HTMLElement, client: OneCardClient): OneCardGameInstance {
  const state = { ...client };

  container.classList.add("onecard-game");
  container.innerHTML = `
    <div class="onecard-table">
      <!-- Opponent Seats -->
      <div class="opponent-seats">
        <div class="seat-top" data-role="seat-top"></div>
        <div class="seat-left" data-role="seat-left"></div>
        <div class="seat-right" data-role="seat-right"></div>
      </div>

      <!-- Center Stage -->
      <div class="onecard-center-stage">
        <!-- Deck / Draw Pile -->
        <div class="onecard-deck" data-role="deck" aria-label="Draw deck">
          <div class="deck-cards">
            <div class="deck-card-back"></div>
            <div class="deck-card-back"></div>
            <div class="deck-card-back"></div>
          </div>
          <div class="deck-info">
            <span class="deck-count" data-role="deck-count">0</span>
            <span class="deck-label">DRAW</span>
          </div>
        </div>

        <!-- Direction Indicators -->
        <div class="direction-indicator" data-role="direction-indicator">
          <div class="direction-arrow arrow-cw">↻</div>
        </div>

        <!-- Discard Pile / Open Card -->
        <div class="onecard-discard" data-role="discard" aria-label="Discard pile">
          <div class="discard-pile-shadows"></div>
          <div class="discard-card-holder" data-role="discard-card-holder"></div>
        </div>

        <!-- Joker Declared Suit Banner -->
        <div class="wild-suit-banner is-hidden" data-role="wild-suit-banner"></div>
        <div class="table-action-toast is-hidden" data-role="action-toast" aria-live="polite"></div>
      </div>

      <!-- Game Status Bar -->
      <div class="onecard-status-bar" data-role="status-bar"></div>
      <div class="turn-tracker" data-role="turn-tracker" aria-live="polite"></div>

      <!-- Bottom / Current Player Hand Area -->
      <div class="player-hand-container" data-role="player-hand-container">
        <div class="hand-header">
          <span class="player-name" data-role="player-name">Your Hand</span>
          <div class="hand-actions">
            <button type="button" class="draw-button is-hidden" data-role="draw-button">Draw</button>
            <button type="button" class="pass-button is-hidden" data-role="pass-button">Pass / End Turn</button>
          </div>
        </div>
        <div class="player-hand" data-role="player-hand"></div>
      </div>

      <!-- Joker Suit Picker Modal -->
      <div class="suit-picker-modal is-hidden" data-role="suit-picker">
        <div class="suit-picker-panel">
          <h3>Choose a Suit</h3>
          <div class="suit-buttons">
            <button type="button" class="suit-btn is-spade" data-suit="S">♠ Spade</button>
            <button type="button" class="suit-btn is-heart" data-suit="H">♥ Heart</button>
            <button type="button" class="suit-btn is-club" data-suit="C">♣ Club</button>
            <button type="button" class="suit-btn is-diamond" data-suit="D">♦ Diamond</button>
          </div>
        </div>
      </div>

      <!-- Result / Match Closed Modal -->
      <div class="onecard-result-modal is-hidden" data-role="result-modal">
        <div class="onecard-result-panel">
          <h2 data-role="result-title">Victory!</h2>
          <p data-role="result-message"></p>
          <div class="result-actions">
            <button type="button" class="result-btn is-primary" data-role="play-again">Play Again</button>
            <button type="button" class="result-btn" data-role="leave-game">Leave</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Query DOM selectors
  const seatTop = container.querySelector<HTMLElement>("[data-role='seat-top']");
  const seatLeft = container.querySelector<HTMLElement>("[data-role='seat-left']");
  const seatRight = container.querySelector<HTMLElement>("[data-role='seat-right']");
  const deckEl = container.querySelector<HTMLElement>("[data-role='deck']");
  const deckCountEl = container.querySelector<HTMLElement>("[data-role='deck-count']");
  const directionEl = container.querySelector<HTMLElement>("[data-role='direction-indicator']");
  const discardHolder = container.querySelector<HTMLElement>("[data-role='discard-card-holder']");
  const discardEl = container.querySelector<HTMLElement>("[data-role='discard']");
  const wildSuitBanner = container.querySelector<HTMLElement>("[data-role='wild-suit-banner']");
  const actionToast = container.querySelector<HTMLElement>("[data-role='action-toast']");
  const statusBar = container.querySelector<HTMLElement>("[data-role='status-bar']");
  const turnTracker = container.querySelector<HTMLElement>("[data-role='turn-tracker']");
  const playerHandContainer = container.querySelector<HTMLElement>("[data-role='player-hand-container']");
  const playerName = container.querySelector<HTMLElement>("[data-role='player-name']");
  const playerHandEl = container.querySelector<HTMLElement>("[data-role='player-hand']");
  const drawButton = container.querySelector<HTMLButtonElement>("[data-role='draw-button']");
  const passButton = container.querySelector<HTMLButtonElement>("[data-role='pass-button']");
  const suitPicker = container.querySelector<HTMLElement>("[data-role='suit-picker']");
  const resultModal = container.querySelector<HTMLElement>("[data-role='result-modal']");
  const resultTitle = container.querySelector<HTMLElement>("[data-role='result-title']");
  const resultMessage = container.querySelector<HTMLElement>("[data-role='result-message']");
  const playAgainBtn = container.querySelector<HTMLButtonElement>("[data-role='play-again']");
  const leaveBtn = container.querySelector<HTMLButtonElement>("[data-role='leave-game']");

  // State variable for pending suit choice
  let pendingJokerCard: string | null = null;
  let pendingJokerSourceEl: HTMLElement | null = null;
  let drawNotice: { playerId: string; count: number; wasAttack: boolean; version: number } | null = null;
  let drawNoticeTimer: number | undefined;
  let actionNotice: ActionNotice | null = null;
  let actionNoticeTimer: number | undefined;
  let localDrawReveal: LocalDrawReveal | null = null;
  let localDrawRevealTimer: number | undefined;
  let localDrawRevealClearTimer: number | undefined;
  let directionFlashTimer: number | undefined;
  let flightTimers: number[] = [];
  let flightElements: HTMLElement[] = [];

  // Set event listeners
  deckEl?.addEventListener("click", () => {
    drawCard();
  });

  drawButton?.addEventListener("click", () => {
    drawCard();
  });

  passButton?.addEventListener("click", () => {
    triggerSelectionFeedback();
    client.sendAction({ type: "pass", payload: {} });
  });

  suitPicker?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-suit]");
    if (btn && pendingJokerCard) {
      const chosenSuit = btn.getAttribute("data-suit");
      triggerCardSubmitFeedback();
      if (pendingJokerSourceEl && discardEl) {
        triggerFlyAnimation(pendingJokerSourceEl, discardEl, pendingJokerCard, {
          label: `You played ${formatCardName(pendingJokerCard)}`,
          tone: "play"
        });
      }
      setActionNotice(`You played ${formatCardName(pendingJokerCard)}`, "play");
      client.sendAction({
        type: "playCard",
        payload: { card: pendingJokerCard, chosenSuit }
      });
      suitPicker.classList.add("is-hidden");
      pendingJokerCard = null;
      pendingJokerSourceEl = null;
    }
  });

  playAgainBtn?.addEventListener("click", () => {
    if (!state.publicView.rematchRequests?.includes(state.playerId)) {
      client.requestPlayAgain();
    }
  });

  leaveBtn?.addEventListener("click", () => {
    client.leaveFinishedGame();
  });

  function renderCard(cardStr: string): HTMLElement {
    const cardEl = document.createElement("div");
    const isBJ = cardStr === "BJ";
    const isCJ = cardStr === "CJ";
    cardEl.dataset.card = cardStr;

    if (isBJ || isCJ) {
      cardEl.className = `onecard-card is-joker ${isCJ ? "is-color-joker" : "is-black-joker"}`;
      cardEl.innerHTML = `
        <div class="card-inner">
          <div class="card-center">🃏</div>
          <div class="joker-text">${isCJ ? "COLOR JOKER" : "B&W JOKER"}</div>
        </div>
      `;
    } else {
      const suit = cardStr.slice(-1) as "S" | "H" | "C" | "D";
      const rank = cardStr.slice(0, -1);
      const symbol = SUIT_SYMBOLS[suit] ?? "";
      const isRed = suit === "H" || suit === "D";

      cardEl.className = `onecard-card ${isRed ? "is-red" : ""}`;
      cardEl.innerHTML = `
        <div class="card-inner">
          <div class="card-corner top-left">
            <span class="card-rank">${rank}</span>
            <span class="card-symbol">${symbol}</span>
          </div>
          <div class="card-center">${symbol}</div>
          <div class="card-corner bottom-right">
            <span class="card-rank">${rank}</span>
            <span class="card-symbol">${symbol}</span>
          </div>
        </div>
      `;
    }
    return cardEl;
  }

  function renderCardBack(): HTMLElement {
    const cardEl = document.createElement("div");
    cardEl.className = "onecard-card is-card-back";
    cardEl.innerHTML = `
      <div class="card-back-pattern">
        <div class="card-back-mark">BH</div>
      </div>
    `;
    return cardEl;
  }

  function getPlayableCards(hand: string[], pub: OneCardPublicView): string[] {
    const topCard = pub.discardPile[pub.discardPile.length - 1];
    if (!topCard) return hand;

    const playable: string[] = [];
    const activeAttack = pub.activeAttackCount > 0;
    const attackCard = pub.activeAttackCard;
    const isAttackJoker = attackCard === "BJ" || attackCard === "CJ";
    const attackRank = attackCard ? (isAttackJoker ? attackCard : attackCard.slice(0, -1)) : "";

    for (const card of hand) {
      const isCardJoker = card === "BJ" || card === "CJ";
      const cardSuit = isCardJoker ? "J" : card.slice(-1);
      const cardRank = isCardJoker ? card : card.slice(0, -1);

      if (activeAttack && attackCard) {
        if (attackRank === "2") {
          if (cardRank === "2" || cardRank === "A" || isCardJoker) playable.push(card);
        } else if (attackRank === "A") {
          if (cardRank === "A" || isCardJoker) playable.push(card);
        } else if (attackCard === "BJ") {
          if (card === "CJ") playable.push(card);
        }
        // CJ cannot be defended, playable remains empty
      } else {
        // No active attack
        if (isCardJoker) {
          playable.push(card);
        } else {
          const isTopJoker = topCard === "BJ" || topCard === "CJ";
          const topSuit = isTopJoker ? "J" : topCard.slice(-1);
          const topRank = isTopJoker ? topCard : topCard.slice(0, -1);

          if ((isTopJoker || topRank === "7") && pub.chosenSuit) {
            if (cardSuit === pub.chosenSuit) playable.push(card);
          } else {
            if (cardSuit === topSuit || cardRank === topRank) playable.push(card);
          }
        }
      }
    }
    return playable;
  }

  function triggerFlyAnimation(
    fromEl: HTMLElement,
    targetEl: HTMLElement,
    cardStr?: string,
    options: { count?: number; label?: string; tone?: ActionNoticeTone } = {}
  ): number {
    const startRect = fromEl.getBoundingClientRect();
    const endRect = targetEl.getBoundingClientRect();
    const count = Math.max(1, options.count ?? 1);
    const flyerCount = Math.min(count, maxBundleFlyers);
    const duration = count > 1 ? bundleFlightMs : singleFlightMs;
    const cardWidth = Math.min(Math.max(startRect.width || 76, 58), 92);
    const cardHeight = cardWidth * 1.38;
    const startCenterX = startRect.left + startRect.width / 2;
    const startCenterY = startRect.top + startRect.height / 2;
    const endCenterX = endRect.left + endRect.width / 2;
    const endCenterY = endRect.top + endRect.height / 2;

    for (let index = 0; index < flyerCount; index += 1) {
      const offset = (index - (flyerCount - 1) / 2) * 8;
      const flyer = cardStr ? renderCard(cardStr) : renderCardBack();
      flyer.classList.add("flyer-animating", options.tone === "play" ? "is-play-flight" : "is-draw-flight");
      if (count > 1) {
        flyer.classList.add("is-bundle-flight");
      }
      flyer.style.position = "fixed";
      flyer.style.left = `${startCenterX - cardWidth / 2 + offset}px`;
      flyer.style.top = `${startCenterY - cardHeight / 2 - Math.abs(offset) * 0.4}px`;
      flyer.style.width = `${cardWidth}px`;
      flyer.style.height = `${cardHeight}px`;
      flyer.style.margin = "0";
      flyer.style.zIndex = "999";
      flyer.style.opacity = "0.9";
      flyer.style.transform = `rotate(${offset * 0.9}deg) scale(${count > 1 ? 0.92 : 1})`;
      flyer.style.transition = [
        `left ${duration}ms cubic-bezier(0.2, 0.82, 0.2, 1)`,
        `top ${duration}ms cubic-bezier(0.2, 0.82, 0.2, 1)`,
        `transform ${duration}ms cubic-bezier(0.2, 0.82, 0.2, 1)`,
        `opacity ${duration}ms ease`
      ].join(", ");
      appendFlightElement(flyer);

      const delay = index * bundleStaggerMs;
      setFlightTimeout(() => {
        requestAnimationFrame(() => {
          const landingOffset = count > 1 ? (index - (flyerCount - 1) / 2) * 5 : 0;
          flyer.style.left = `${endCenterX - cardWidth / 2 + landingOffset}px`;
          flyer.style.top = `${endCenterY - cardHeight / 2 - Math.abs(landingOffset) * 0.35}px`;
          flyer.style.transform = `rotate(${landingOffset * -1.4 + (Math.random() * 8 - 4)}deg) scale(${cardStr ? 0.98 : 0.88})`;
          flyer.style.opacity = "1";
        });
      }, delay);

      setFlightTimeout(() => {
        flyer.style.opacity = "0";
        setFlightTimeout(() => removeFlightElement(flyer), 120);
      }, duration + delay);
    }

    if (count > 1) {
      const badge = document.createElement("div");
      badge.className = "card-flight-badge";
      badge.textContent = `+${count}`;
      badge.style.left = `${startCenterX}px`;
      badge.style.top = `${startCenterY}px`;
      appendFlightElement(badge);
      requestAnimationFrame(() => {
        badge.style.left = `${endCenterX}px`;
        badge.style.top = `${endCenterY - cardHeight * 0.45}px`;
      });
      setFlightTimeout(() => {
        badge.classList.add("is-fading");
        setFlightTimeout(() => removeFlightElement(badge), 180);
      }, duration + (flyerCount - 1) * bundleStaggerMs);
    }

    if (options.label) {
      const label = document.createElement("div");
      label.className = `card-flight-label is-${options.tone ?? "draw"}`;
      label.textContent = options.label;
      label.style.left = `${startCenterX}px`;
      label.style.top = `${startCenterY - cardHeight * 0.7}px`;
      appendFlightElement(label);
      requestAnimationFrame(() => {
        label.style.left = `${endCenterX}px`;
        label.style.top = `${endCenterY - cardHeight * 0.75}px`;
      });
      setFlightTimeout(() => {
        label.classList.add("is-fading");
        setFlightTimeout(() => removeFlightElement(label), 160);
      }, duration + 160);
    }

    return duration + (flyerCount - 1) * bundleStaggerMs;
  }

  function setDrawNotice(playerId: string, count: number, wasAttack: boolean, version: number): void {
    if (drawNoticeTimer) window.clearTimeout(drawNoticeTimer);
    drawNotice = { playerId, count, wasAttack, version };
    drawNoticeTimer = window.setTimeout(() => {
      if (drawNotice?.version === version) {
        drawNotice = null;
        render();
      }
    }, 2400);
  }

  function setActionNotice(text: string, tone: ActionNoticeTone): void {
    if (actionNoticeTimer) window.clearTimeout(actionNoticeTimer);
    actionNotice = { text, tone };
    actionNoticeTimer = window.setTimeout(() => {
      actionNotice = null;
      render();
    }, 1_800);
    renderActionToast();
  }

  function scheduleLocalDrawReveal(startIndex: number, count: number, version: number, delayMs: number): void {
    if (localDrawRevealTimer) window.clearTimeout(localDrawRevealTimer);
    if (localDrawRevealClearTimer) window.clearTimeout(localDrawRevealClearTimer);
    localDrawReveal = { startIndex, count, version, revealed: false };
    localDrawRevealTimer = window.setTimeout(() => {
      if (localDrawReveal?.version !== version) return;
      localDrawReveal.revealed = true;
      render();
      localDrawRevealClearTimer = window.setTimeout(() => {
        if (localDrawReveal?.version === version) {
          localDrawReveal = null;
          render();
        }
      }, drawRevealHoldMs);
    }, Math.max(180, delayMs - 80));
  }

  function setFlightTimeout(callback: () => void, delayMs: number): void {
    const timer = window.setTimeout(() => {
      flightTimers = flightTimers.filter((candidate) => candidate !== timer);
      callback();
    }, delayMs);
    flightTimers.push(timer);
  }

  function appendFlightElement(element: HTMLElement): void {
    flightElements.push(element);
    document.body.appendChild(element);
  }

  function removeFlightElement(element: HTMLElement): void {
    element.remove();
    flightElements = flightElements.filter((candidate) => candidate !== element);
  }

  function clearFlightAnimations(): void {
    for (const timer of flightTimers) {
      window.clearTimeout(timer);
    }
    flightTimers = [];
    for (const element of flightElements) {
      element.remove();
    }
    flightElements = [];
  }

  function findDrawFromSnapshot(oldPub: OneCardPublicView, newPub: OneCardPublicView): { playerId: string; count: number; wasAttack: boolean } | null {
    const actorId = oldPub.currentPlayerId;
    if (!actorId) return null;
    const oldCount = oldPub.hands[actorId]?.count;
    const newCount = newPub.hands[actorId]?.count;
    if (oldCount === undefined || newCount === undefined || newCount <= oldCount) return null;
    if (newPub.discardPile.length > oldPub.discardPile.length) return null;
    return { playerId: actorId, count: newCount - oldCount, wasAttack: oldPub.activeAttackCount > 0 };
  }

  function drawCard(): void {
    const isMyTurn = state.publicView.currentPlayerId === state.playerId;
    if (isMyTurn && !state.publicView.winnerPlayerId) {
      triggerSelectionFeedback();
      client.sendAction({ type: "drawCard", payload: {} });
    }
  }

  function render(): void {
    const pub = state.publicView;
    const priv = state.privateView;
    const N = Object.keys(pub.hands).length || 2;
    const isMyTurn = pub.currentPlayerId === state.playerId && !pub.winnerPlayerId;
    const nextPlayerId = getNextPlayerId(pub);
    const playable = getPlayableCards(priv.hand, pub);
    const hasPlayableCard = playable.length > 0;

    // Render deck count
    if (deckCountEl) {
      deckCountEl.textContent = String(pub.deckCount);
    }
    if (deckEl) {
      if (isMyTurn) {
        deckEl.classList.add("is-glow");
      } else {
        deckEl.classList.remove("is-glow");
      }
    }

    // Render direction indicator
    if (directionEl) {
      directionEl.className = `direction-indicator ${pub.turnDirection === "clockwise" ? "is-clockwise" : "is-counterclockwise"}`;
      directionEl.ariaLabel = `${pub.turnDirection} turn direction`;
      directionEl.innerHTML = pub.turnDirection === "clockwise"
        ? `<div class="direction-arrow arrow-cw">↻</div>`
        : `<div class="direction-arrow arrow-ccw">↺</div>`;
    }

    // Render open card discard pile
    if (discardHolder) {
      discardHolder.innerHTML = "";
      const topCard = pub.discardPile[pub.discardPile.length - 1];
      if (topCard) {
        discardHolder.appendChild(renderCard(topCard));
      }
    }

    // Render Wild Suit banner if Joker suit declared
    if (wildSuitBanner) {
      if (pub.chosenSuit) {
        wildSuitBanner.classList.remove("is-hidden");
        const symbol = SUIT_SYMBOLS[pub.chosenSuit] ?? "";
        const name = SUIT_NAMES[pub.chosenSuit] ?? "";
        const isRed = pub.chosenSuit === "H" || pub.chosenSuit === "D";
        wildSuitBanner.className = `wild-suit-banner ${isRed ? "is-red" : ""}`;
        wildSuitBanner.innerHTML = `Wild Suit: <span class="wild-suit-symbol">${symbol}</span> ${name}`;
      } else {
        wildSuitBanner.classList.add("is-hidden");
      }
    }

    // Render dynamic seat positions
    renderSeats();
    renderTurnTracker(pub, nextPlayerId);
    renderActionToast();

    if (playerHandContainer) {
      playerHandContainer.classList.toggle("is-active-turn", isMyTurn);
      playerHandContainer.classList.toggle("is-next-turn", nextPlayerId === state.playerId && !isMyTurn && !pub.winnerPlayerId);
    }
    if (playerName) {
      playerName.textContent = isMyTurn ? "Your Hand - Turn" : nextPlayerId === state.playerId ? "Your Hand - Next" : "Your Hand";
    }

    // Render Pass button (Only visible if King played and hasExtraTurn is true)
    if (drawButton) {
      if (isMyTurn) {
        drawButton.classList.remove("is-hidden");
        drawButton.classList.toggle("is-urgent", pub.activeAttackCount > 0 && !hasPlayableCard);
        drawButton.textContent = pub.activeAttackCount > 0 ? `Draw +${pub.activeAttackCount}` : "Draw";
      } else {
        drawButton.classList.add("is-hidden");
        drawButton.classList.remove("is-urgent");
      }
    }
    if (passButton) {
      if (isMyTurn && pub.hasExtraTurn) {
        passButton.classList.remove("is-hidden");
      } else {
        passButton.classList.add("is-hidden");
      }
    }

    // Render status bar message
    if (statusBar) {
      statusBar.innerHTML = "";
      if (pub.winnerPlayerId) {
        statusBar.textContent = pub.winnerPlayerId === state.playerId ? "🏆 You Won!" : "Game Over";
      } else if (pub.activeAttackCount > 0) {
        statusBar.className = "onecard-status-bar active-attack";
        statusBar.innerHTML = hasPlayableCard
          ? `Attack <strong>+${pub.activeAttackCount}</strong>: defend or draw`
          : `Attack <strong>+${pub.activeAttackCount}</strong>: no defense card, draw from the deck`;
      } else if (drawNotice) {
        statusBar.className = "onecard-status-bar draw-notice";
        const subject = drawNotice.playerId === state.playerId ? "You" : getPlayerName(drawNotice.playerId);
        const cardText = drawNotice.count === 1 ? "1 card" : `${drawNotice.count} cards`;
        statusBar.textContent = drawNotice.wasAttack
          ? `${subject} picked up ${cardText} from the deck.`
          : `${subject} drew ${cardText} from the deck.`;
      } else {
        statusBar.className = "onecard-status-bar";
        if (isMyTurn) {
          statusBar.textContent = pub.hasExtraTurn ? "Extra turn: play or pass" : "Your turn: play or draw";
        } else {
          const activeName = getPlayerName(pub.currentPlayerId);
          statusBar.textContent = `Waiting for ${activeName}...`;
        }
      }
    }

    // Render player's hand cards
    if (playerHandEl) {
      playerHandEl.innerHTML = "";
      playerHandEl.style.setProperty("--hand-card-overlap", `${getMobileHandOverlap(priv.hand.length)}px`);

      priv.hand.forEach((card, index) => {
        const cardEl = renderCard(card);
        const isPlayable = isMyTurn && playable.includes(card);
        const reveal = localDrawReveal;
        const isDrawReveal =
          reveal !== null &&
          index >= reveal.startIndex &&
          index < reveal.startIndex + reveal.count;

        if (isDrawReveal && reveal) {
          cardEl.classList.add(reveal.revealed ? "is-newly-drawn" : "is-draw-pending");
          cardEl.style.setProperty("--draw-reveal-index", String(index - reveal.startIndex));
        }

        if (isPlayable) {
          cardEl.classList.add("is-playable");
          cardEl.addEventListener("click", () => {
            const rank = card === "BJ" || card === "CJ" ? card : card.slice(0, -1);
            if (card === "BJ" || card === "CJ" || rank === "7") {
              triggerSelectionFeedback();
              pendingJokerCard = card;
              pendingJokerSourceEl = cardEl;
              suitPicker?.classList.remove("is-hidden");
            } else {
              triggerCardSubmitFeedback();
              if (discardEl) {
                triggerFlyAnimation(cardEl, discardEl, card, {
                  label: `You played ${formatCardName(card)}`,
                  tone: "play"
                });
              }
              setActionNotice(`You played ${formatCardName(card)}`, "play");
              client.sendAction({ type: "playCard", payload: { card } });
            }
          });
        }
        playerHandEl.appendChild(cardEl);
      });
    }

    renderResultModal();
  }

  function getPlayerName(playerId?: string): string {
    if (!playerId) return "Opponent";
    if (playerId === state.playerId) return "You";
    return playerId.slice(0, 8); // truncate ID nicely
  }

  function formatCardName(card: string): string {
    return card;
  }

  function getMobileHandOverlap(cardCount: number): number {
    if (cardCount >= 15) return -44;
    if (cardCount >= 12) return -40;
    if (cardCount >= 9) return -34;
    if (cardCount >= 8) return -28;
    return -24;
  }

  function getRelativeSeat(playerId: string): "bottom" | "left" | "top" | "right" {
    const playersList = Object.keys(state.publicView.hands);
    const myIndex = playersList.indexOf(state.playerId);
    const targetIndex = playersList.indexOf(playerId);
    if (myIndex < 0 || targetIndex < 0) return "top";

    const N = playersList.length;
    const rel = (targetIndex - myIndex + N) % N;

    if (rel === 0) return "bottom";
    if (N === 2) return "top"; // 2 players: opponent is top
    if (N === 3) {
      return rel === 1 ? "left" : "top"; // 3 players: left, top
    }
    // 4 players
    if (rel === 1) return "left";
    if (rel === 2) return "top";
    return "right";
  }

  function getPlayerTargetElement(playerId: string): HTMLElement | null {
    if (playerId === state.playerId) return playerHandEl;
    const relativeSeat = getRelativeSeat(playerId);
    if (relativeSeat === "top") return seatTop;
    if (relativeSeat === "left") return seatLeft;
    if (relativeSeat === "right") return seatRight;
    return null;
  }

  function getNextPlayerId(pub: OneCardPublicView): string | undefined {
    const players = Object.keys(pub.hands).filter((playerId) => !pub.eliminatedPlayerIds.includes(playerId));
    if (!pub.currentPlayerId || players.length <= 1) return undefined;
    const currentIndex = players.indexOf(pub.currentPlayerId);
    if (currentIndex < 0) return undefined;
    const offset = pub.turnDirection === "clockwise" ? 1 : -1;
    return players[(currentIndex + offset + players.length) % players.length];
  }

  function renderTurnTracker(pub: OneCardPublicView, nextPlayerId?: string): void {
    if (!turnTracker) return;
    const directionLabel = pub.turnDirection === "clockwise" ? "Clockwise" : "Counterclockwise";
    const directionArrow = pub.turnDirection === "clockwise" ? "↻" : "↺";
    turnTracker.className = `turn-tracker ${pub.turnDirection === "clockwise" ? "is-clockwise" : "is-counterclockwise"}`;
    turnTracker.innerHTML = `
      <span class="turn-pill is-direction">${directionArrow} ${directionLabel}</span>
      <span class="turn-pill is-current">Turn: ${getPlayerName(pub.currentPlayerId)}</span>
      ${nextPlayerId ? `<span class="turn-pill is-next">Next: ${getPlayerName(nextPlayerId)}</span>` : ""}
    `;
  }

  function renderActionToast(): void {
    if (!actionToast) return;
    if (!actionNotice) {
      actionToast.className = "table-action-toast is-hidden";
      actionToast.textContent = "";
      return;
    }
    actionToast.className = `table-action-toast is-${actionNotice.tone}`;
    actionToast.textContent = actionNotice.text;
  }

  function flashDirectionIndicator(): void {
    if (!directionEl) return;
    if (directionFlashTimer) window.clearTimeout(directionFlashTimer);
    directionEl.classList.remove("is-direction-flash");
    void directionEl.offsetWidth;
    directionEl.classList.add("is-direction-flash");
    directionFlashTimer = window.setTimeout(() => {
      directionEl.classList.remove("is-direction-flash");
      directionFlashTimer = undefined;
    }, 900);
  }

  function renderSeats() {
    const pub = state.publicView;
    const playersList = Object.keys(pub.hands);
    const nextPlayerId = getNextPlayerId(pub);

    // Reset all seats
    if (seatTop) seatTop.innerHTML = "";
    if (seatLeft) seatLeft.innerHTML = "";
    if (seatRight) seatRight.innerHTML = "";

    playersList.forEach((pid) => {
      if (pid === state.playerId) return; // Skip us

      const rel = getRelativeSeat(pid);
      const seatEl = rel === "top" ? seatTop : rel === "left" ? seatLeft : rel === "right" ? seatRight : null;
      if (!seatEl) return;

      const handInfo = pub.hands[pid];
      const count = handInfo?.count ?? 0;
      const isTurn = pub.currentPlayerId === pid && !pub.winnerPlayerId;
      const isNext = nextPlayerId === pid && !pub.winnerPlayerId;
      const isBankrupt = pub.eliminatedPlayerIds.includes(pid);

      seatEl.innerHTML = `
        <div class="opponent-profile ${isTurn ? "is-active-turn" : ""} ${isNext ? "is-next-turn" : ""} ${isBankrupt ? "is-bankrupt" : ""}">
          <div class="opponent-avatar">👤</div>
          <div class="opponent-name">${getPlayerName(pid)}</div>
          <div class="opponent-hand-preview">
            <div class="card-back-icon">🎴</div>
            <span class="opponent-card-count">x${count}</span>
          </div>
          ${isBankrupt ? `<div class="bankrupt-badge">BANKRUPT</div>` : ""}
          ${count === 1 && !isBankrupt ? `<div class="onecard-badge">ONE CARD!</div>` : ""}
        </div>
      `;
    });
  }

  function renderResultModal(): void {
    const pub = state.publicView;
    if (!pub.winnerPlayerId || pub.roomPhase !== "finished") {
      resultModal?.classList.add("is-hidden");
      if (playAgainBtn) {
        playAgainBtn.disabled = false;
        playAgainBtn.textContent = "Play Again";
      }
      return;
    }

    const requested = pub.rematchRequests ?? [];
    const iRequested = requested.includes(state.playerId);
    const oppRequested = requested.some((id) => id !== state.playerId);

    if (resultTitle) {
      resultTitle.textContent = pub.winnerPlayerId === state.playerId ? "🏆 Victory!" : "Defeat";
    }

    if (resultMessage) {
      const winnerName = getPlayerName(pub.winnerPlayerId);
      resultMessage.innerHTML = `
        <strong>${winnerName}</strong> has won the match!<br/><br/>
        ${
          iRequested
            ? "Waiting for opponent..."
            : oppRequested
              ? "Opponent wants to play again."
              : "Choose whether to play another round."
        }
      `;
    }

    if (playAgainBtn) {
      playAgainBtn.disabled = iRequested;
      playAgainBtn.textContent = iRequested ? "Waiting..." : "Play Again";
    }

    resultModal?.classList.remove("is-hidden");
  }

  render();

  return {
    update(input) {
      if (state.version === input.version) return;
      const oldPub = state.publicView;
      const newPub = input.publicView;
      const directionChanged = oldPub?.turnDirection !== undefined && newPub?.turnDirection !== undefined && oldPub.turnDirection !== newPub.turnDirection;

      if (oldPub && newPub && newPub.discardPile.length > oldPub.discardPile.length) {
        const topPlayed = newPub.discardPile[newPub.discardPile.length - 1]!;
        const actorId = oldPub.currentPlayerId;
        if (actorId) {
          setActionNotice(`${getPlayerName(actorId)} played ${formatCardName(topPlayed)}`, "play");
        }
        if (actorId && actorId !== input.playerId) {
          const sourceSeatEl = getPlayerTargetElement(actorId);

          if (sourceSeatEl && discardEl) {
            triggerFlyAnimation(sourceSeatEl, discardEl, topPlayed, {
              label: `${getPlayerName(actorId)} played ${formatCardName(topPlayed)}`,
              tone: "play"
            });
          }
        }
      }

      const draw = oldPub && newPub ? findDrawFromSnapshot(oldPub, newPub) : null;
      if (draw && deckEl) {
        const targetEl = getPlayerTargetElement(draw.playerId);
        const subject = getPlayerName(draw.playerId);
        const cardText = draw.count === 1 ? "1 card" : `${draw.count} cards`;
        let animationMs = 0;
        if (targetEl) {
          animationMs = triggerFlyAnimation(deckEl, targetEl, undefined, {
            count: draw.count,
            label: draw.wasAttack ? `${subject} takes +${draw.count}` : `${subject} drew ${cardText}`,
            tone: draw.wasAttack ? "attack" : "draw"
          });
        }
        if (draw.playerId === input.playerId) {
          const oldHandLength = state.privateView?.hand?.length ?? 0;
          const newCardCount = Math.max(0, (input.privateView?.hand?.length ?? 0) - oldHandLength);
          if (newCardCount > 0) {
            scheduleLocalDrawReveal(oldHandLength, newCardCount, input.version, animationMs || singleFlightMs);
          }
        }
        setDrawNotice(draw.playerId, draw.count, draw.wasAttack, input.version);
        setActionNotice(draw.wasAttack ? `${subject} picked up ${cardText}` : `${subject} drew ${cardText}`, draw.wasAttack ? "attack" : "draw");
      }

      if (directionChanged) {
        setActionNotice(`Direction reversed: ${newPub.turnDirection}`, "turn");
      }

      state.playerId = input.playerId;
      state.version = input.version;
      state.publicView = input.publicView;
      state.privateView = input.privateView;
      render();
      if (directionChanged) {
        flashDirectionIndicator();
      }
    },
    destroy() {
      if (drawNoticeTimer) window.clearTimeout(drawNoticeTimer);
      if (actionNoticeTimer) window.clearTimeout(actionNoticeTimer);
      if (localDrawRevealTimer) window.clearTimeout(localDrawRevealTimer);
      if (localDrawRevealClearTimer) window.clearTimeout(localDrawRevealClearTimer);
      if (directionFlashTimer) window.clearTimeout(directionFlashTimer);
      clearFlightAnimations();
      container.classList.remove("onecard-game");
      container.innerHTML = "";
    }
  };
}

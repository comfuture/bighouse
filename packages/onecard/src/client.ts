import "./style.css";
import type { GameClientContext, MountedGameClient } from "@bighouse/game-sdk/client";
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
      </div>

      <!-- Game Status Bar -->
      <div class="onecard-status-bar" data-role="status-bar"></div>

      <!-- Bottom / Current Player Hand Area -->
      <div class="player-hand-container">
        <div class="hand-header">
          <span class="player-name">Your Hand</span>
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
  const statusBar = container.querySelector<HTMLElement>("[data-role='status-bar']");
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
  let drawNotice: { playerId: string; count: number; wasAttack: boolean; version: number } | null = null;
  let drawNoticeTimer: ReturnType<typeof window.setTimeout> | undefined;

  // Set event listeners
  deckEl?.addEventListener("click", () => {
    drawCard();
  });

  drawButton?.addEventListener("click", () => {
    drawCard();
  });

  passButton?.addEventListener("click", () => {
    client.sendAction({ type: "pass", payload: {} });
  });

  suitPicker?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-suit]");
    if (btn && pendingJokerCard) {
      const chosenSuit = btn.getAttribute("data-suit");
      client.sendAction({
        type: "playCard",
        payload: { card: pendingJokerCard, chosenSuit }
      });
      suitPicker.classList.add("is-hidden");
      pendingJokerCard = null;
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

  function triggerFlyAnimation(fromEl: HTMLElement, targetEl: HTMLElement, cardStr?: string) {
    const startRect = fromEl.getBoundingClientRect();
    const endRect = targetEl.getBoundingClientRect();

    const flyer = cardStr ? renderCard(cardStr) : renderCardBack();
    flyer.classList.add("flyer-animating");
    flyer.style.position = "fixed";
    flyer.style.left = `${startRect.left}px`;
    flyer.style.top = `${startRect.top}px`;
    flyer.style.width = `${startRect.width}px`;
    flyer.style.height = `${startRect.height}px`;
    flyer.style.margin = "0";
    flyer.style.zIndex = "999";
    flyer.style.transition = "all 0.45s cubic-bezier(0.25, 1, 0.5, 1)";
    document.body.appendChild(flyer);

    requestAnimationFrame(() => {
      flyer.style.left = `${endRect.left}px`;
      flyer.style.top = `${endRect.top}px`;
      flyer.style.transform = `rotate(${Math.random() * 20 - 10}deg) scale(0.95)`;
    });

    setTimeout(() => {
      flyer.remove();
    }, 450);
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
      client.sendAction({ type: "drawCard", payload: {} });
    }
  }

  function render(): void {
    const pub = state.publicView;
    const priv = state.privateView;
    const N = Object.keys(pub.hands).length || 2;
    const isMyTurn = pub.currentPlayerId === state.playerId && !pub.winnerPlayerId;
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

      priv.hand.forEach((card) => {
        const cardEl = renderCard(card);
        const isPlayable = isMyTurn && playable.includes(card);

        if (isPlayable) {
          cardEl.classList.add("is-playable");
          cardEl.addEventListener("click", () => {
            const rank = card === "BJ" || card === "CJ" ? card : card.slice(0, -1);
            if (card === "BJ" || card === "CJ" || rank === "7") {
              pendingJokerCard = card;
              suitPicker?.classList.remove("is-hidden");
            } else {
              if (discardEl) {
                triggerFlyAnimation(cardEl, discardEl, card);
              }
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

  function renderSeats() {
    const pub = state.publicView;
    const playersList = Object.keys(pub.hands);

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
      const isBankrupt = pub.eliminatedPlayerIds.includes(pid);

      seatEl.innerHTML = `
        <div class="opponent-profile ${isTurn ? "is-active-turn" : ""} ${isBankrupt ? "is-bankrupt" : ""}">
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

      if (oldPub && newPub && newPub.discardPile.length > oldPub.discardPile.length) {
        const topPlayed = newPub.discardPile[newPub.discardPile.length - 1]!;
        const actorId = oldPub.currentPlayerId;
        if (actorId && actorId !== input.playerId) {
          let sourceSeatEl: HTMLElement | null = null;
          const relativeSeat = getRelativeSeat(actorId);
          if (relativeSeat === "top") sourceSeatEl = seatTop;
          else if (relativeSeat === "left") sourceSeatEl = seatLeft;
          else if (relativeSeat === "right") sourceSeatEl = seatRight;

          if (sourceSeatEl && discardEl) {
            triggerFlyAnimation(sourceSeatEl, discardEl, topPlayed);
          }
        }
      }

      const draw = oldPub && newPub ? findDrawFromSnapshot(oldPub, newPub) : null;
      if (draw && deckEl) {
        let targetEl: HTMLElement | null = null;
        if (draw.playerId === input.playerId) {
          targetEl = playerHandEl;
        } else {
          const relativeSeat = getRelativeSeat(draw.playerId);
          if (relativeSeat === "top") targetEl = seatTop;
          else if (relativeSeat === "left") targetEl = seatLeft;
          else if (relativeSeat === "right") targetEl = seatRight;
        }
        if (targetEl) {
          triggerFlyAnimation(deckEl, targetEl);
        }
        setDrawNotice(draw.playerId, draw.count, draw.wasAttack, input.version);
      }

      state.playerId = input.playerId;
      state.version = input.version;
      state.publicView = input.publicView;
      state.privateView = input.privateView;
      render();
    },
    destroy() {
      if (drawNoticeTimer) window.clearTimeout(drawNoticeTimer);
      container.classList.remove("onecard-game");
      container.innerHTML = "";
    }
  };
}

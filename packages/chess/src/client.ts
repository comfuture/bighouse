import "./style.css";
import type { GameClientContext, GameClientSnapshot, MountedGameClient } from "@bighouse/game-sdk/client";
import { triggerPlacementFeedback, triggerSelectionFeedback } from "@bighouse/game-sdk/feedback";
import { createGameUi, type GameResultDialogState } from "@bighouse/ui";
import { moveDestinationHints, type ChessSquare } from "./move-hints";
import bB from "./assets/pieces/bB.svg?url";
import bK from "./assets/pieces/bK.svg?url";
import bN from "./assets/pieces/bN.svg?url";
import bP from "./assets/pieces/bP.svg?url";
import bQ from "./assets/pieces/bQ.svg?url";
import bR from "./assets/pieces/bR.svg?url";
import wB from "./assets/pieces/wB.svg?url";
import wK from "./assets/pieces/wK.svg?url";
import wN from "./assets/pieces/wN.svg?url";
import wP from "./assets/pieces/wP.svg?url";
import wQ from "./assets/pieces/wQ.svg?url";
import wR from "./assets/pieces/wR.svg?url";
export { gameMetadata } from "./client-metadata";

type ChessColor = "w" | "b";
type ChessPiece = "p" | "n" | "b" | "r" | "q" | "k";

type ChessPieceView = {
  square: ChessSquare;
  type: ChessPiece;
  color: ChessColor;
};

type ChessPublicView = {
  roomPhase?: "waiting" | "active" | "finished" | "closed";
  fen: string;
  board: Array<Array<ChessPieceView | null>>;
  currentPlayerId?: string;
  turn: ChessColor;
  clocks?: Record<"white" | "black", number>;
  activeClockStartedAt?: number;
  turnDeadline?: number;
  moveCount: number;
  history: string[];
  lastMove?: { from: ChessSquare; to: ChessSquare; san: string; playerId: string };
  winnerPlayerId?: string;
  result?: "checkmate" | "stalemate" | "draw" | "timeout";
  drawReason?: string;
  check: boolean;
};

type ChessPrivateView = {
  color?: "white" | "black";
};

type ChessClient = {
  playerId: string;
  version: number;
  serverTime: number;
  publicView: ChessPublicView;
  privateView: ChessPrivateView;
  sendAction(action: { type: string; payload: Record<string, unknown> }): void;
  requestPlayAgain(): void;
  leaveFinishedGame(): void;
};

const pieceUrls: Record<string, string> = {
  bk: bK,
  bq: bQ,
  br: bR,
  bb: bB,
  bn: bN,
  bp: bP,
  wk: wK,
  wq: wQ,
  wr: wR,
  wb: wB,
  wn: wN,
  wp: wP
};

export function mountGame(container: HTMLElement, context: GameClientContext): MountedGameClient {
  const instance = createChessGame(container, toChessClient(context));
  const gameUi = createGameUi(container, context, context);
  gameUi.setResult(chessResultDialogState(context));
  return {
    update(nextContext) {
      instance.update(toChessClient({ ...context, ...nextContext }));
      gameUi.update(nextContext);
      gameUi.setResult(chessResultDialogState(nextContext));
    },
    destroy() {
      gameUi.destroy();
      instance.destroy();
    }
  };
}

export function createChessGame(container: HTMLElement, client: ChessClient) {
  const state = { ...client, receivedAt: performance.now() };
  let selected: ChessSquare | undefined;
  let pendingPromotion: { from: ChessSquare; to: ChessSquare } | undefined;
  let seenLastMoveKey = moveKey(client.publicView);
  let pendingMoveAnimationKey: string | undefined;
  let checkWasActive = false;
  let checkOverlayTimer: ReturnType<typeof setTimeout> | undefined;
  const surface = document.createElement("div");
  surface.className = "game-contained-surface chess-game";
  container.replaceChildren(surface);
  surface.innerHTML = `
    <div class="chess-header">
      <div class="chess-status" data-role="status"></div>
      <div class="chess-turn-notice is-hidden" data-role="turn-notice" aria-live="polite">
        <span class="chess-turn-dot" aria-hidden="true"></span>
        <span>Your move</span>
        <span class="chess-turn-color" data-role="turn-color"></span>
      </div>
    </div>
    <div class="chess-clocks" aria-label="Chess clocks">
      <div class="chess-clock" data-role="clock-white">
        <span class="chess-clock-label">White</span>
        <span class="chess-clock-time" data-role="clock-white-time">15:00</span>
      </div>
      <div class="chess-clock" data-role="clock-black">
        <span class="chess-clock-label">Black</span>
        <span class="chess-clock-time" data-role="clock-black-time">15:00</span>
      </div>
    </div>
    <div class="chess-layout">
      <div class="chess-board-frame" data-role="board-frame">
        <div class="chess-check-overlay is-hidden" data-role="check-overlay" aria-live="assertive">Check</div>
        <div class="chess-board" data-role="board" aria-label="Chess board"></div>
        <div class="chess-move-ghost-layer" data-role="move-ghost-layer" aria-hidden="true"></div>
      </div>
      <aside class="chess-side">
        <div class="chess-side-title">Moves</div>
        <ol class="chess-history" data-role="history"></ol>
      </aside>
      <div class="chess-promotion-modal is-hidden" data-role="promotion-modal" role="dialog" aria-modal="true">
        <div class="chess-promotion-panel" data-role="promotion-panel"></div>
      </div>
    </div>
  `;

  const status = requireElement<HTMLElement>(surface, "[data-role='status']");
  const turnNotice = requireElement<HTMLElement>(surface, "[data-role='turn-notice']");
  const turnColor = requireElement<HTMLElement>(surface, "[data-role='turn-color']");
  const boardFrame = requireElement<HTMLElement>(surface, "[data-role='board-frame']");
  const checkOverlay = requireElement<HTMLElement>(surface, "[data-role='check-overlay']");
  const board = requireElement<HTMLElement>(surface, "[data-role='board']");
  const moveGhostLayer = requireElement<HTMLElement>(surface, "[data-role='move-ghost-layer']");
  const history = requireElement<HTMLOListElement>(surface, "[data-role='history']");
  const whiteClock = requireElement<HTMLElement>(surface, "[data-role='clock-white']");
  const blackClock = requireElement<HTMLElement>(surface, "[data-role='clock-black']");
  const whiteClockTime = requireElement<HTMLElement>(surface, "[data-role='clock-white-time']");
  const blackClockTime = requireElement<HTMLElement>(surface, "[data-role='clock-black-time']");
  const promotionModal = requireElement<HTMLElement>(surface, "[data-role='promotion-modal']");
  const promotionPanel = requireElement<HTMLElement>(surface, "[data-role='promotion-panel']");
  let moveGhostCleanupTimer: ReturnType<typeof setTimeout> | undefined;
  const clockTimer = setInterval(() => {
    renderClocks();
  }, 1_000);

  function render(): void {
    const { publicView, privateView, playerId } = state;
    const active = publicView.roomPhase === undefined || publicView.roomPhase === "active";
    const myTurn = active && publicView.currentPlayerId === playerId && !publicView.result;
    const colorLabel = privateView.color ?? "spectator";
    const destinations = selected && myTurn ? moveDestinationHints(publicView.fen, selected) : undefined;
    const scrollSnapshot = captureScrollSnapshot(history);
    status.textContent = statusText(publicView, playerId, myTurn, colorLabel);
    turnNotice.classList.toggle("is-hidden", !myTurn);
    turnColor.textContent = colorLabel;
    boardFrame.classList.toggle("is-my-turn", myTurn);
    board.classList.toggle("is-black-perspective", privateView.color === "black");
    renderClocks();
    updateCheckOverlay(publicView.check);
    clearMoveGhost();
    board.innerHTML = "";

    for (const square of orderedSquares(privateView.color === "black")) {
      const piece = pieceAt(publicView.board, square);
      const legalDestination = destinations?.legal.has(square) === true && selected !== square;
      const unsafeDestination = destinations?.unsafe.has(square) === true && selected !== square;
      const checkedKing = publicView.check && piece?.type === "k" && piece.color === publicView.turn;
      const cell = document.createElement("button");
      const light = squareColor(square) === "light";
      cell.type = "button";
      cell.dataset.square = square;
      cell.className = [
        "chess-cell",
        light ? "is-light" : "is-dark",
        selected === square ? "is-selected" : "",
        legalDestination ? "is-legal-destination" : "",
        unsafeDestination ? "is-unsafe-destination" : "",
        checkedKing ? "is-in-check" : "",
        publicView.lastMove?.from === square || publicView.lastMove?.to === square ? "is-last" : ""
      ].join(" ");
      cell.dataset.gameElastic = "off";
      cell.disabled = !active || Boolean(publicView.result);
      cell.ariaLabel = `${piece ? `${pieceName(piece)} on ${square}` : `empty ${square}`}${legalDestination ? ", legal move" : ""}${unsafeDestination ? ", unsafe move would leave king in check" : ""}`;
      cell.addEventListener("mousedown", (event) => event.preventDefault());
      cell.addEventListener("click", (event) => {
        event.preventDefault();
        const keyboardActivated = event.detail === 0;
        handleSquareClick(square, piece);
        if (keyboardActivated) board.querySelector<HTMLButtonElement>(`[data-square="${square}"]`)?.focus();
      });
      if (piece) {
        const img = document.createElement("img");
        img.src = pieceUrls[`${piece.color}${piece.type}`]!;
        img.alt = pieceName(piece);
        img.draggable = false;
        cell.append(img);
      }
      board.append(cell);
    }

    history.innerHTML = "";
    for (let index = 0; index < publicView.history.length; index += 2) {
      const moveNumber = Math.floor(index / 2) + 1;
      const whiteMove = publicView.history[index];
      const blackMove = publicView.history[index + 1] ?? "";
      const item = document.createElement("li");
      item.textContent = `${moveNumber}. ${whiteMove} ${blackMove}`.trim();
      history.append(item);
    }
    renderMoveGhost(publicView);
    renderPromotion();
    restoreScrollSnapshot(history, scrollSnapshot);
  }

  function handleSquareClick(square: ChessSquare, piece: ChessPieceView | undefined): void {
    if (state.publicView.currentPlayerId !== state.playerId || state.publicView.result) return;
    const myColor = state.privateView.color === "black" ? "b" : "w";
    if (!selected) {
      if (piece?.color === myColor) {
        triggerSelectionFeedback();
        selected = square;
        render();
      }
      return;
    }
    if (selected === square) {
      triggerSelectionFeedback();
      selected = undefined;
      render();
      return;
    }
    if (piece?.color === myColor) {
      triggerSelectionFeedback();
      selected = square;
      render();
      return;
    }
    if (!moveDestinationHints(state.publicView.fen, selected).legal.has(square)) {
      return;
    }
    const movingPiece = pieceAt(state.publicView.board, selected);
    if (movingPiece?.type === "p" && (square.endsWith("8") || square.endsWith("1"))) {
      triggerSelectionFeedback();
      pendingPromotion = { from: selected, to: square };
      selected = undefined;
      render();
      return;
    }
    triggerPlacementFeedback();
    client.sendAction({ type: "move", payload: { from: selected, to: square } });
    selected = undefined;
  }

  function renderPromotion(): void {
    if (!pendingPromotion) {
      promotionModal.classList.add("is-hidden");
      promotionPanel.innerHTML = "";
      return;
    }
    const color = state.privateView.color === "black" ? "b" : "w";
    promotionPanel.innerHTML = "";
    for (const piece of ["q", "r", "b", "n"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chess-promotion-choice";
      button.ariaLabel = `Promote to ${pieceName({ color, type: piece, square: pendingPromotion.to })}`;
      const img = document.createElement("img");
      img.src = pieceUrls[`${color}${piece}`]!;
      img.alt = "";
      img.draggable = false;
      button.append(img);
      button.addEventListener("click", () => {
        const move = pendingPromotion;
        pendingPromotion = undefined;
        if (move) {
          triggerPlacementFeedback();
          client.sendAction({ type: "move", payload: { from: move.from, to: move.to, promotion: piece } });
        }
      });
      promotionPanel.append(button);
    }
    promotionModal.classList.remove("is-hidden");
  }

  function updateCheckOverlay(check: boolean): void {
    if (check && !checkWasActive) {
      flashCheckOverlay();
    }
    checkWasActive = check;
  }

  function flashCheckOverlay(): void {
    if (checkOverlayTimer) {
      clearTimeout(checkOverlayTimer);
    }
    checkOverlay.classList.remove("is-hidden", "is-flashing");
    void checkOverlay.offsetWidth;
    checkOverlay.classList.add("is-flashing");
    checkOverlayTimer = setTimeout(() => {
      checkOverlay.classList.add("is-hidden");
      checkOverlay.classList.remove("is-flashing");
      checkOverlayTimer = undefined;
    }, 1_150);
  }

  function renderMoveGhost(publicView: ChessPublicView): void {
    const move = publicView.lastMove;
    if (!move || !pendingMoveAnimationKey || moveKey(publicView) !== pendingMoveAnimationKey) return;
    const piece = pieceAt(publicView.board, move.to);
    if (!piece) return;
    const toCell = board.querySelector<HTMLElement>(`[data-square="${move.to}"]`);
    const targetImg = toCell?.querySelector<HTMLImageElement>("img");
    if (!targetImg) return;

    const blackPerspective = state.privateView.color === "black";
    const fromPosition = displayPosition(move.from, blackPerspective);
    const toPosition = displayPosition(move.to, blackPerspective);
    const ghost = document.createElement("img");
    ghost.className = "chess-move-ghost-piece";
    ghost.src = pieceUrls[`${piece.color}${piece.type}`]!;
    ghost.alt = "";
    ghost.draggable = false;
    ghost.style.left = `${toPosition.column * 12.5}%`;
    ghost.style.top = `${toPosition.row * 12.5}%`;
    ghost.style.width = "12.5%";
    ghost.style.height = "12.5%";
    ghost.style.setProperty("--chess-move-x", `${(fromPosition.column - toPosition.column) * 100}%`);
    ghost.style.setProperty("--chess-move-y", `${(fromPosition.row - toPosition.row) * 100}%`);
    targetImg.classList.add("is-move-target-hidden");
    moveGhostLayer.append(ghost);

    const finish = (): void => {
      ghost.remove();
      targetImg.classList.remove("is-move-target-hidden");
      if (moveGhostCleanupTimer) {
        clearTimeout(moveGhostCleanupTimer);
        moveGhostCleanupTimer = undefined;
      }
    };
    ghost.addEventListener("animationend", finish, { once: true });
    moveGhostCleanupTimer = setTimeout(finish, 360);
  }

  function clearMoveGhost(): void {
    if (moveGhostCleanupTimer) {
      clearTimeout(moveGhostCleanupTimer);
      moveGhostCleanupTimer = undefined;
    }
    board.querySelectorAll(".is-move-target-hidden").forEach((element) => {
      element.classList.remove("is-move-target-hidden");
    });
    moveGhostLayer.innerHTML = "";
  }

  function renderClocks(now = serverNow()): void {
    renderClock("white", whiteClock, whiteClockTime, now);
    renderClock("black", blackClock, blackClockTime, now);
  }

  function renderClock(color: "white" | "black", containerEl: HTMLElement, timeEl: HTMLElement, now: number): void {
    const remaining = clockRemainingMs(state.publicView, color, now);
    const active = state.publicView.roomPhase === "active" && !state.publicView.result && colorForTurn(state.publicView.turn) === color;
    containerEl.classList.toggle("is-active", active);
    containerEl.classList.toggle("is-low", remaining <= 60_000);
    timeEl.textContent = formatClock(remaining);
    containerEl.ariaLabel = `${color} ${formatClock(remaining)}${active ? " running" : ""}`;
  }

  function serverNow(): number {
    return state.serverTime + Math.max(0, performance.now() - state.receivedAt);
  }

  render();

  return {
    update(input: Omit<ChessClient, "sendAction" | "requestPlayAgain" | "leaveFinishedGame">) {
      const sameVersion = state.version === input.version;
      state.serverTime = input.serverTime;
      state.receivedAt = performance.now();
      if (sameVersion) {
        renderClocks();
        return;
      }
      state.playerId = input.playerId;
      state.version = input.version;
      state.publicView = input.publicView;
      state.privateView = input.privateView;
      const nextLastMoveKey = moveKey(input.publicView);
      pendingMoveAnimationKey = nextLastMoveKey && nextLastMoveKey !== seenLastMoveKey ? nextLastMoveKey : undefined;
      seenLastMoveKey = nextLastMoveKey;
      selected = undefined;
      pendingPromotion = undefined;
      render();
      pendingMoveAnimationKey = undefined;
    },
    destroy() {
      clearInterval(clockTimer);
      if (checkOverlayTimer) {
        clearTimeout(checkOverlayTimer);
      }
      clearMoveGhost();
      surface.remove();
    }
  };
}

function toChessClient(context: GameClientContext): ChessClient {
  return {
    playerId: context.playerId,
    version: context.version,
    serverTime: context.serverTime,
    publicView: {
      ...(context.publicView as ChessPublicView),
      roomPhase: context.phase
    },
    privateView: context.privateView as ChessPrivateView,
    sendAction: context.sendAction,
    requestPlayAgain: context.requestPlayAgain,
    leaveFinishedGame: context.leaveFinishedGame
  };
}

function chessResultDialogState(context: GameClientSnapshot): GameResultDialogState {
  const publicView = context.publicView as ChessPublicView;
  if (context.phase !== "finished" || !publicView.result) {
    return { open: false, title: "", message: "" };
  }
  const privateView = context.privateView as ChessPrivateView;
  const isSpectator = !privateView.color;
  const iRequested = context.rematchRequests.includes(context.playerId);
  let title: string;
  let message: string;
  if (publicView.winnerPlayerId) {
    title = isSpectator
      ? "Game Over"
      : publicView.winnerPlayerId === context.playerId
        ? resultTitleFor(publicView.result)
        : "Game Over";
    message = isSpectator
      ? resultMessageFor(publicView.result)
      : publicView.winnerPlayerId === context.playerId
        ? winningMessageFor(publicView.result)
        : losingMessageFor(publicView.result);
  } else {
    title = "Draw";
    message = publicView.drawReason
      ? `Draw by ${publicView.drawReason.replaceAll("_", " ")}.`
      : "The game ended in a draw.";
  }
  return {
    open: true,
    kicker: "Match complete",
    title,
    message: iRequested ? `${message} Waiting for your opponent to accept the rematch.` : message,
    primaryLabel: isSpectator ? "Spectating" : iRequested ? "Waiting..." : "Play again",
    secondaryLabel: "Leave",
    primaryDisabled: isSpectator || iRequested
  };
}

function requireElement<T extends Element>(container: HTMLElement, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Failed to mount chess game: ${selector}`);
  return element;
}

type ScrollSnapshot = {
  windowX: number;
  windowY: number;
  historyTop: number;
};

function captureScrollSnapshot(history: HTMLElement): ScrollSnapshot {
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    historyTop: history.scrollTop
  };
}

function restoreScrollSnapshot(history: HTMLElement, snapshot: ScrollSnapshot): void {
  history.scrollTop = snapshot.historyTop;
  window.scrollTo(snapshot.windowX, snapshot.windowY);
  requestAnimationFrame(() => {
    history.scrollTop = snapshot.historyTop;
    window.scrollTo(snapshot.windowX, snapshot.windowY);
  });
}

function orderedSquares(blackPerspective: boolean): ChessSquare[] {
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
  const ranks = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;
  const orderedFiles = blackPerspective ? [...files].reverse() : files;
  const orderedRanks = blackPerspective ? [...ranks].reverse() : ranks;
  return orderedRanks.flatMap((rank) => orderedFiles.map((file) => `${file}${rank}` as ChessSquare));
}

function pieceAt(board: ChessPublicView["board"], square: ChessSquare): ChessPieceView | undefined {
  for (const row of board) {
    const piece = row.find((candidate) => candidate?.square === square);
    if (piece) return piece;
  }
  return undefined;
}

function squareColor(square: ChessSquare): "light" | "dark" {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(square[1]) - 1;
  return (file + rank) % 2 === 0 ? "dark" : "light";
}

function moveKey(publicView: ChessPublicView): string | undefined {
  const move = publicView.lastMove;
  return move ? `${publicView.moveCount}:${move.playerId}:${move.from}:${move.to}:${move.san}` : undefined;
}

function displayPosition(square: ChessSquare, blackPerspective: boolean): { column: number; row: number } {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(square[1]) - 1;
  return blackPerspective
    ? { column: 7 - file, row: rank }
    : { column: file, row: 7 - rank };
}

function pieceName(piece: ChessPieceView): string {
  const color = piece.color === "w" ? "white" : "black";
  const names: Record<ChessPiece, string> = {
    p: "pawn",
    n: "knight",
    b: "bishop",
    r: "rook",
    q: "queen",
    k: "king"
  };
  return `${color} ${names[piece.type]}`;
}

function statusText(publicView: ChessPublicView, playerId: string, myTurn: boolean, colorLabel: string): string {
  if (publicView.result) {
    if (publicView.winnerPlayerId) {
      if (colorLabel === "spectator") {
        return "Game Over";
      }
      return publicView.winnerPlayerId === playerId ? "You Win!" : "You Lose!";
    }
    return "Draw";
  }
  if (myTurn) return `Your turn (${colorLabel})`;
  if (publicView.check) return `Check - waiting for ${publicView.currentPlayerId ?? "opponent"}`;
  return publicView.roomPhase === "active" || publicView.roomPhase === undefined
    ? `Waiting for ${publicView.currentPlayerId ?? "opponent"}`
    : "Waiting for opponent";
}

function clockRemainingMs(publicView: ChessPublicView, color: "white" | "black", serverNow: number): number {
  const clocks = publicView.clocks ?? { white: 15 * 60 * 1000, black: 15 * 60 * 1000 };
  const base = Number.isFinite(clocks[color]) ? clocks[color] : 15 * 60 * 1000;
  if (
    publicView.roomPhase === "active" &&
    !publicView.result &&
    colorForTurn(publicView.turn) === color &&
    publicView.activeClockStartedAt !== undefined
  ) {
    return Math.max(0, base - Math.max(0, serverNow - publicView.activeClockStartedAt));
  }
  return Math.max(0, base);
}

function colorForTurn(turn: ChessColor): "white" | "black" {
  return turn === "w" ? "white" : "black";
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function resultTitleFor(result: ChessPublicView["result"]): string {
  return result === "timeout" ? "Time Forfeit" : "Checkmate";
}

function resultMessageFor(result: ChessPublicView["result"]): string {
  return result === "timeout" ? "The game ended on time." : "The game ended in checkmate.";
}

function winningMessageFor(result: ChessPublicView["result"]): string {
  return result === "timeout" ? "You won on time." : "You won by checkmate.";
}

function losingMessageFor(result: ChessPublicView["result"]): string {
  return result === "timeout" ? "You lost on time." : "You lost by checkmate.";
}

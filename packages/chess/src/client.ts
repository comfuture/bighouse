import "./style.css";
import type { GameClientContext, MountedGameClient } from "@bighouse/game-sdk/client";
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
  return {
    update(nextContext) {
      instance.update(toChessClient({ ...context, ...nextContext }));
    },
    destroy() {
      instance.destroy();
    }
  };
}

export function createChessGame(container: HTMLElement, client: ChessClient) {
  const state = { ...client };
  let selected: ChessSquare | undefined;
  let pendingPromotion: { from: ChessSquare; to: ChessSquare } | undefined;
  let seenLastMoveKey = moveKey(client.publicView);
  let pendingMoveAnimationKey: string | undefined;
  let checkWasActive = false;
  let checkOverlayTimer: ReturnType<typeof setTimeout> | undefined;
  container.classList.add("chess-game");
  container.innerHTML = `
    <div class="chess-status" data-role="status"></div>
    <div class="chess-layout">
      <div class="chess-board-frame" data-role="board-frame">
        <div class="chess-turn-notice is-hidden" data-role="turn-notice" aria-live="polite">
          <span class="chess-turn-dot" aria-hidden="true"></span>
          <span>Your move</span>
          <span class="chess-turn-color" data-role="turn-color"></span>
        </div>
        <div class="chess-check-overlay is-hidden" data-role="check-overlay" aria-live="assertive">Check</div>
        <div class="chess-board" data-role="board" aria-label="Chess board"></div>
      </div>
      <aside class="chess-side">
        <div class="chess-side-title">Moves</div>
        <ol class="chess-history" data-role="history"></ol>
      </aside>
      <div class="chess-result-modal is-hidden" data-role="result-modal" role="dialog" aria-modal="true">
        <div class="chess-result-panel">
          <div class="chess-result-title" data-role="result-title"></div>
          <div class="chess-result-message" data-role="result-message"></div>
          <div class="chess-result-actions">
            <button type="button" class="chess-result-button is-primary" data-role="play-again">Play Again</button>
            <button type="button" class="chess-result-button" data-role="leave-game">Leave</button>
          </div>
        </div>
      </div>
      <div class="chess-promotion-modal is-hidden" data-role="promotion-modal" role="dialog" aria-modal="true">
        <div class="chess-promotion-panel" data-role="promotion-panel"></div>
      </div>
    </div>
  `;

  const status = requireElement<HTMLElement>(container, "[data-role='status']");
  const turnNotice = requireElement<HTMLElement>(container, "[data-role='turn-notice']");
  const turnColor = requireElement<HTMLElement>(container, "[data-role='turn-color']");
  const boardFrame = requireElement<HTMLElement>(container, "[data-role='board-frame']");
  const checkOverlay = requireElement<HTMLElement>(container, "[data-role='check-overlay']");
  const board = requireElement<HTMLElement>(container, "[data-role='board']");
  const history = requireElement<HTMLOListElement>(container, "[data-role='history']");
  const modal = requireElement<HTMLElement>(container, "[data-role='result-modal']");
  const resultTitle = requireElement<HTMLElement>(container, "[data-role='result-title']");
  const resultMessage = requireElement<HTMLElement>(container, "[data-role='result-message']");
  const playAgainButton = requireElement<HTMLButtonElement>(container, "[data-role='play-again']");
  const leaveButton = requireElement<HTMLButtonElement>(container, "[data-role='leave-game']");
  const promotionModal = requireElement<HTMLElement>(container, "[data-role='promotion-modal']");
  const promotionPanel = requireElement<HTMLElement>(container, "[data-role='promotion-panel']");

  playAgainButton.addEventListener("click", () => {
    client.requestPlayAgain();
  });
  leaveButton.addEventListener("click", () => {
    client.leaveFinishedGame();
  });

  function render(): void {
    const { publicView, privateView, playerId } = state;
    const active = publicView.roomPhase === undefined || publicView.roomPhase === "active";
    const myTurn = active && publicView.currentPlayerId === playerId && !publicView.result;
    const colorLabel = privateView.color ?? "spectator";
    const destinations = selected && myTurn ? moveDestinationHints(publicView.fen, selected) : undefined;
    status.textContent = statusText(publicView, playerId, myTurn, colorLabel);
    turnNotice.classList.toggle("is-hidden", !myTurn);
    turnColor.textContent = colorLabel;
    boardFrame.classList.toggle("is-my-turn", myTurn);
    board.classList.toggle("is-black-perspective", privateView.color === "black");
    updateCheckOverlay(publicView.check);
    board.innerHTML = "";

    for (const square of orderedSquares(privateView.color === "black")) {
      const piece = pieceAt(publicView.board, square);
      const legalDestination = destinations?.legal.has(square) === true && selected !== square;
      const unsafeDestination = destinations?.unsafe.has(square) === true && selected !== square;
      const checkedKing = publicView.check && piece?.type === "k" && piece.color === publicView.turn;
      const animateMove = piece && pendingMoveAnimationKey && moveKey(publicView) === pendingMoveAnimationKey && publicView.lastMove?.to === square;
      const cell = document.createElement("button");
      const light = squareColor(square) === "light";
      cell.type = "button";
      cell.className = [
        "chess-cell",
        light ? "is-light" : "is-dark",
        selected === square ? "is-selected" : "",
        legalDestination ? "is-legal-destination" : "",
        unsafeDestination ? "is-unsafe-destination" : "",
        checkedKing ? "is-in-check" : "",
        publicView.lastMove?.from === square || publicView.lastMove?.to === square ? "is-last" : ""
      ].join(" ");
      cell.disabled = !active || Boolean(publicView.result);
      cell.ariaLabel = `${piece ? `${pieceName(piece)} on ${square}` : `empty ${square}`}${legalDestination ? ", legal move" : ""}${unsafeDestination ? ", unsafe move would leave king in check" : ""}`;
      cell.addEventListener("click", () => handleSquareClick(square, piece));
      if (piece) {
        const img = document.createElement("img");
        img.src = pieceUrls[`${piece.color}${piece.type}`]!;
        img.alt = pieceName(piece);
        img.draggable = false;
        if (animateMove && publicView.lastMove) {
          const offset = moveAnimationOffset(publicView.lastMove.from, publicView.lastMove.to, privateView.color === "black");
          img.classList.add("is-moving-piece");
          img.style.setProperty("--chess-move-x", String(offset.x));
          img.style.setProperty("--chess-move-y", String(offset.y));
        }
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
    renderResult();
    renderPromotion();
  }

  function handleSquareClick(square: ChessSquare, piece: ChessPieceView | undefined): void {
    if (state.publicView.currentPlayerId !== state.playerId || state.publicView.result) return;
    const myColor = state.privateView.color === "black" ? "b" : "w";
    if (!selected) {
      if (piece?.color === myColor) {
        selected = square;
        render();
      }
      return;
    }
    if (selected === square) {
      selected = undefined;
      render();
      return;
    }
    if (piece?.color === myColor) {
      selected = square;
      render();
      return;
    }
    if (!moveDestinationHints(state.publicView.fen, selected).legal.has(square)) {
      return;
    }
    const movingPiece = pieceAt(state.publicView.board, selected);
    if (movingPiece?.type === "p" && (square.endsWith("8") || square.endsWith("1"))) {
      pendingPromotion = { from: selected, to: square };
      selected = undefined;
      render();
      return;
    }
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
          client.sendAction({ type: "move", payload: { from: move.from, to: move.to, promotion: piece } });
        }
      });
      promotionPanel.append(button);
    }
    promotionModal.classList.remove("is-hidden");
  }

  function renderResult(): void {
    const { publicView, privateView, playerId } = state;
    if (!publicView.result || publicView.roomPhase !== "finished") {
      modal.classList.add("is-hidden");
      playAgainButton.style.display = "";
      return;
    }
    const isSpectator = !privateView.color;
    if (publicView.winnerPlayerId) {
      if (isSpectator) {
        resultTitle.textContent = "Game Over";
        resultMessage.textContent = resultMessageFor(publicView.result);
      } else {
        resultTitle.textContent = publicView.winnerPlayerId === playerId ? resultTitleFor(publicView.result) : "Game Over";
        resultMessage.textContent = publicView.winnerPlayerId === playerId
          ? winningMessageFor(publicView.result)
          : losingMessageFor(publicView.result);
      }
    } else {
      resultTitle.textContent = "Draw";
      resultMessage.textContent = publicView.drawReason ? `Draw by ${publicView.drawReason.replaceAll("_", " ")}.` : "The game ended in a draw.";
    }
    playAgainButton.style.display = isSpectator ? "none" : "";
    modal.classList.remove("is-hidden");
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

  render();

  return {
    update(input: Omit<ChessClient, "sendAction" | "requestPlayAgain" | "leaveFinishedGame">) {
      if (state.version === input.version) return;
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
      if (checkOverlayTimer) {
        clearTimeout(checkOverlayTimer);
      }
      container.classList.remove("chess-game");
      container.innerHTML = "";
    }
  };
}

function toChessClient(context: GameClientContext): ChessClient {
  return {
    playerId: context.playerId,
    version: context.version,
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

function requireElement<T extends Element>(container: HTMLElement, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Failed to mount chess game: ${selector}`);
  return element;
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

function moveAnimationOffset(from: ChessSquare, to: ChessSquare, blackPerspective: boolean): { x: number; y: number } {
  const start = displayPosition(from, blackPerspective);
  const end = displayPosition(to, blackPerspective);
  return {
    x: start.column - end.column,
    y: start.row - end.row
  };
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

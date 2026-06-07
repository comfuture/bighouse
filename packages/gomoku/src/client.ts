import "./style.css";
import type { GameClientContext, JsonObject, MountedGameClient } from "@bighouse/game-sdk/client";
import { triggerPlacementFeedback } from "@bighouse/game-sdk/feedback";
export { gameMetadata } from "./client-metadata";

export type GomokuStone = "black" | "white";
export type GomokuCell = GomokuStone | null;

export type GomokuPublicView = {
  roomPhase?: "waiting" | "active" | "finished" | "closed";
  boardSize: number;
  board: GomokuCell[][];
  currentPlayerId?: string;
  turnDeadline?: number;
  moveCount: number;
  rematchRequests?: string[];
  lastMove?: {
    playerId: string;
    x: number;
    y: number;
    stone: GomokuStone;
  };
  winnerPlayerId?: string;
};

export type GomokuPrivateView = {
  stone?: GomokuStone;
};

export type GomokuClient = {
  playerId: string;
  version: number;
  publicView: GomokuPublicView;
  privateView: GomokuPrivateView;
  sendAction(action: { type: string; payload: Record<string, unknown> }): void;
  requestPlayAgain(): void;
  leaveFinishedGame(): void;
};

export type GomokuGameInstance = {
  update(input: Omit<GomokuClient, "sendAction" | "requestPlayAgain" | "leaveFinishedGame">): void;
  destroy(): void;
};

export function mountGame(container: HTMLElement, context: GameClientContext): MountedGameClient {
  const instance = createGomokuGame(container, toGomokuClient(context));
  return {
    update(nextContext) {
      instance.update(toGomokuClient({ ...context, ...nextContext }));
    },
    destroy() {
      instance.destroy();
    }
  };
}

export function createGomokuGame(container: HTMLElement, client: GomokuClient): GomokuGameInstance {
  const state = { ...client };
  container.classList.add("gomoku-game");
  container.innerHTML = `
    <div class="gomoku-status" data-role="status"></div>
    <div class="gomoku-stage">
      <div class="gomoku-board" data-role="board" aria-label="Gomoku board"></div>
      <div class="gomoku-result-modal is-hidden" data-role="result-modal" role="dialog" aria-modal="true">
        <div class="gomoku-result-panel">
          <div class="gomoku-result-title" data-role="result-title"></div>
          <div class="gomoku-result-message" data-role="result-message"></div>
          <div class="gomoku-result-actions">
            <button type="button" class="gomoku-result-button is-primary" data-role="play-again">Play Again</button>
            <button type="button" class="gomoku-result-button" data-role="leave-game">Leave</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const status = container.querySelector<HTMLElement>("[data-role='status']");
  const boardEl = container.querySelector<HTMLElement>("[data-role='board']");
  const modal = container.querySelector<HTMLElement>("[data-role='result-modal']");
  const resultTitle = container.querySelector<HTMLElement>("[data-role='result-title']");
  const resultMessage = container.querySelector<HTMLElement>("[data-role='result-message']");
  const playAgainButton = container.querySelector<HTMLButtonElement>("[data-role='play-again']");
  const leaveButton = container.querySelector<HTMLButtonElement>("[data-role='leave-game']");
  if (!status || !boardEl || !modal || !resultTitle || !resultMessage || !playAgainButton || !leaveButton) {
    throw new Error("Failed to mount gomoku game");
  }
  const statusEl = status;
  const boardElement = boardEl;
  const modalElement = modal;
  const resultTitleElement = resultTitle;
  const resultMessageElement = resultMessage;
  const playAgainButtonElement = playAgainButton;
  const leaveButtonElement = leaveButton;

  playAgainButtonElement.addEventListener("click", () => {
    if (!state.publicView.rematchRequests?.includes(state.playerId)) {
      client.requestPlayAgain();
    }
  });
  leaveButtonElement.addEventListener("click", () => {
    client.leaveFinishedGame();
  });

  function render(): void {
    const { publicView, privateView, playerId } = state;
    const isActive = publicView.roomPhase === undefined || publicView.roomPhase === "active";
    const isMyTurn = isActive && publicView.currentPlayerId === playerId && !publicView.winnerPlayerId;
    const stoneLabel = privateView.stone ? `${privateView.stone} stone` : "spectator";
    statusEl.textContent = publicView.winnerPlayerId
      ? publicView.winnerPlayerId === playerId
        ? "You Win!"
        : "You Lose!"
      : isMyTurn
        ? `Your turn (${stoneLabel})`
        : !isActive
          ? "Waiting for opponent"
          : `Waiting for ${publicView.currentPlayerId ?? "opponent"}`;
    boardElement.style.setProperty("--board-size", String(publicView.boardSize));
    boardElement.innerHTML = "";

    for (let y = 0; y < publicView.boardSize; y += 1) {
      for (let x = 0; x < publicView.boardSize; x += 1) {
        const cell = document.createElement("button");
        const value = publicView.board[y]?.[x] ?? null;
        const legal = isLegalMove(publicView, privateView, playerId, x, y);
        const isLast = publicView.lastMove?.x === x && publicView.lastMove.y === y;
        cell.type = "button";
        cell.className = [
          "gomoku-cell",
          value ? `is-${value}` : "is-empty",
          legal ? "is-legal" : "is-blocked",
          isLast ? "is-last" : ""
        ].join(" ");
        cell.disabled = !legal;
        cell.ariaLabel = value ? `${value} stone at ${x + 1}, ${y + 1}` : `empty ${x + 1}, ${y + 1}`;
        cell.addEventListener("click", () => {
          if (!isLegalMove(state.publicView, state.privateView, state.playerId, x, y)) {
            return;
          }
          triggerPlacementFeedback();
          client.sendAction({ type: "placeStone", payload: { x, y } });
        });
        boardElement.append(cell);
      }
    }
    renderResultModal();
  }

  function renderResultModal(): void {
    const { publicView, playerId } = state;
    if (!publicView.winnerPlayerId || publicView.roomPhase !== "finished") {
      modalElement.classList.add("is-hidden");
      playAgainButtonElement.disabled = false;
      playAgainButtonElement.textContent = "Play Again";
      resultMessageElement.textContent = "";
      return;
    }

    const requestedPlayerIds = publicView.rematchRequests ?? [];
    const iRequested = requestedPlayerIds.includes(playerId);
    const opponentRequested = requestedPlayerIds.some((requestPlayerId) => requestPlayerId !== playerId);
    resultTitleElement.textContent = publicView.winnerPlayerId === playerId ? "You Win!" : "You Lose!";
    resultMessageElement.textContent = iRequested
      ? "Waiting for opponent..."
      : opponentRequested
        ? "Opponent wants to play again."
        : "Choose whether to play another round.";
    playAgainButtonElement.disabled = iRequested;
    playAgainButtonElement.textContent = iRequested ? "Waiting..." : "Play Again";
    modalElement.classList.remove("is-hidden");
  }

  render();

  return {
    update(input) {
      if (state.version === input.version) return;
      state.playerId = input.playerId;
      state.version = input.version;
      state.publicView = input.publicView;
      state.privateView = input.privateView;
      render();
    },
    destroy() {
      container.classList.remove("gomoku-game");
      container.innerHTML = "";
    }
  };
}

export function isLegalMove(
  publicView: GomokuPublicView,
  privateView: GomokuPrivateView,
  playerId: string,
  x: number,
  y: number
): boolean {
  if (publicView.winnerPlayerId || publicView.currentPlayerId !== playerId) {
    return false;
  }
  if (publicView.roomPhase !== undefined && publicView.roomPhase !== "active") {
    return false;
  }
  if (!privateView.stone) {
    return false;
  }
  if (publicView.board[y]?.[x] !== null) {
    return false;
  }
  return !createsDoubleThree(publicView.board, x, y, privateView.stone);
}

function toGomokuClient(context: GameClientContext): GomokuClient {
  return {
    playerId: context.playerId,
    version: context.version,
    publicView: {
      ...(context.publicView as GomokuPublicView),
      roomPhase: context.phase,
      rematchRequests: context.rematchRequests
    },
    privateView: context.privateView as GomokuPrivateView,
    sendAction: context.sendAction,
    requestPlayAgain: context.requestPlayAgain,
    leaveFinishedGame: context.leaveFinishedGame
  };
}

function createsDoubleThree(board: GomokuCell[][], x: number, y: number, stone: GomokuStone): boolean {
  const virtualStone = { x, y, stone };
  const openThreeCount = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ].filter(([dx, dy]) => isOpenThree(board, x, y, stone, dx!, dy!, virtualStone)).length;
  return openThreeCount >= 2;
}

type VirtualStone = {
  x: number;
  y: number;
  stone: GomokuStone;
};

function isOpenThree(
  board: GomokuCell[][],
  x: number,
  y: number,
  stone: GomokuStone,
  dx: number,
  dy: number,
  virtualStone?: VirtualStone
): boolean {
  const line = collectLine(board, x, y, dx, dy, virtualStone);
  const center = line.findIndex((cell) => cell.x === x && cell.y === y);
  if (center < 0) {
    return false;
  }
  for (let start = 0; start <= line.length - 5; start += 1) {
    const end = start + 4;
    if (center < start || center > end) {
      continue;
    }
    const values = line.slice(start, start + 5).map((cell) => cell.value);
    if (
      values[0] === null &&
      values[4] === null &&
      values.filter((value) => value === stone).length === 3 &&
      values.filter((value) => value === null).length === 2 &&
      countLine(board, x, y, stone, dx, dy, virtualStone) === 3
    ) {
      return true;
    }
  }
  return false;
}

function collectLine(
  board: GomokuCell[][],
  x: number,
  y: number,
  dx: number,
  dy: number,
  virtualStone?: VirtualStone
): Array<{ x: number; y: number; value: GomokuCell }> {
  const cells: Array<{ x: number; y: number; value: GomokuCell }> = [];
  let sx = x;
  let sy = y;
  while (cellValue(board, sx - dx, sy - dy, virtualStone) !== undefined) {
    sx -= dx;
    sy -= dy;
  }
  let cx = sx;
  let cy = sy;
  while (cellValue(board, cx, cy, virtualStone) !== undefined) {
    cells.push({ x: cx, y: cy, value: cellValue(board, cx, cy, virtualStone)! });
    cx += dx;
    cy += dy;
  }
  return cells;
}

function countLine(
  board: GomokuCell[][],
  x: number,
  y: number,
  stone: GomokuStone,
  dx: number,
  dy: number,
  virtualStone?: VirtualStone
): number {
  return (
    1 +
    countDirection(board, x, y, stone, dx, dy, virtualStone) +
    countDirection(board, x, y, stone, -dx, -dy, virtualStone)
  );
}

function countDirection(
  board: GomokuCell[][],
  x: number,
  y: number,
  stone: GomokuStone,
  dx: number,
  dy: number,
  virtualStone?: VirtualStone
): number {
  let count = 0;
  let cx = x + dx;
  let cy = y + dy;
  while (cellValue(board, cx, cy, virtualStone) === stone) {
    count += 1;
    cx += dx;
    cy += dy;
  }
  return count;
}

function cellValue(board: GomokuCell[][], x: number, y: number, virtualStone?: VirtualStone): GomokuCell | undefined {
  if (virtualStone && virtualStone.x === x && virtualStone.y === y) {
    return virtualStone.stone;
  }
  return board[y]?.[x];
}

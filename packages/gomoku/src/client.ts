import "./style.css";
import type { GameClientContext, GameClientSnapshot, JsonObject, MountedGameClient } from "@bighouse/game-sdk/client";
import { triggerPlacementFeedback } from "@bighouse/game-sdk/feedback";
import { createGameUi, type GameResultDialogState } from "@bighouse/ui";
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
  const gameUi = createGameUi(container, context, context);
  gameUi.setResult(gomokuResultDialogState(context));
  return {
    update(nextContext) {
      instance.update(toGomokuClient({ ...context, ...nextContext }));
      gameUi.update(nextContext);
      gameUi.setResult(gomokuResultDialogState(nextContext));
    },
    destroy() {
      gameUi.destroy();
      instance.destroy();
    }
  };
}

export function createGomokuGame(container: HTMLElement, client: GomokuClient): GomokuGameInstance {
  const state = { ...client };
  container.classList.add("gomoku-game");
  container.innerHTML = `
    <div class="gomoku-status" data-role="status"></div>
    <div class="gomoku-stage" data-role="stage">
      <div class="gomoku-board" data-role="board" aria-label="Gomoku board"></div>
    </div>
  `;

  const status = container.querySelector<HTMLElement>("[data-role='status']");
  const stage = container.querySelector<HTMLElement>("[data-role='stage']");
  const boardEl = container.querySelector<HTMLElement>("[data-role='board']");
  if (!status || !stage || !boardEl) {
    throw new Error("Failed to mount gomoku game");
  }
  const statusEl = status;
  const stageElement = stage;
  const boardElement = boardEl;

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
    const scrollSnapshot = captureScrollSnapshot(stageElement);
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
        cell.dataset.gameElastic = "off";
        cell.disabled = !legal;
        cell.ariaLabel = value ? `${value} stone at ${x + 1}, ${y + 1}` : `empty ${x + 1}, ${y + 1}`;
        cell.addEventListener("mousedown", preventButtonFocus);
        cell.addEventListener("click", (event) => {
          event.preventDefault();
          cell.blur();
          if (!isLegalMove(state.publicView, state.privateView, state.playerId, x, y)) {
            return;
          }
          triggerPlacementFeedback();
          client.sendAction({ type: "placeStone", payload: { x, y } });
        });
        boardElement.append(cell);
      }
    }
    restoreScrollSnapshot(stageElement, scrollSnapshot);
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

type ScrollSnapshot = {
  windowX: number;
  windowY: number;
  stageLeft: number;
  stageTop: number;
};

function captureScrollSnapshot(stage: HTMLElement): ScrollSnapshot {
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    stageLeft: stage.scrollLeft,
    stageTop: stage.scrollTop
  };
}

function restoreScrollSnapshot(stage: HTMLElement, snapshot: ScrollSnapshot): void {
  stage.scrollLeft = snapshot.stageLeft;
  stage.scrollTop = snapshot.stageTop;
  window.scrollTo(snapshot.windowX, snapshot.windowY);
  requestAnimationFrame(() => {
    stage.scrollLeft = snapshot.stageLeft;
    stage.scrollTop = snapshot.stageTop;
    window.scrollTo(snapshot.windowX, snapshot.windowY);
  });
}

function preventButtonFocus(event: MouseEvent): void {
  event.preventDefault();
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

function gomokuResultDialogState(context: GameClientSnapshot): GameResultDialogState {
  const publicView = context.publicView as GomokuPublicView;
  if (context.phase !== "finished" || !publicView.winnerPlayerId) {
    return { open: false, title: "", message: "" };
  }
  const iRequested = context.rematchRequests.includes(context.playerId);
  const opponentRequested = context.rematchRequests.some((playerId) => playerId !== context.playerId);
  return {
    open: true,
    kicker: "Five in a row",
    title: publicView.winnerPlayerId === context.playerId ? "You Win!" : "You Lose!",
    message: iRequested
      ? "Waiting for your opponent to accept the rematch."
      : opponentRequested
        ? "Your opponent wants to play again."
        : "Choose whether to play another round.",
    primaryLabel: iRequested ? "Waiting..." : "Play again",
    secondaryLabel: "Leave",
    primaryDisabled: iRequested
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

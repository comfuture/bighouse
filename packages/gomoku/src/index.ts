export type GomokuStone = "black" | "white";
export type GomokuCell = GomokuStone | null;

export type GomokuPublicView = {
  boardSize: number;
  board: GomokuCell[][];
  currentPlayerId?: string;
  turnDeadline?: number;
  moveCount: number;
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
};

export type GomokuGameInstance = {
  update(input: Omit<GomokuClient, "sendAction">): void;
  destroy(): void;
};

export function createGomokuGame(container: HTMLElement, client: GomokuClient): GomokuGameInstance {
  const state = { ...client };
  container.classList.add("gomoku-game");
  container.innerHTML = `
    <div class="gomoku-status" data-role="status"></div>
    <div class="gomoku-board" data-role="board" aria-label="Gomoku board"></div>
  `;

  const status = container.querySelector<HTMLElement>("[data-role='status']");
  const boardEl = container.querySelector<HTMLElement>("[data-role='board']");
  if (!status || !boardEl) {
    throw new Error("Failed to mount gomoku game");
  }
  const statusEl = status;
  const boardElement = boardEl;

  function render(): void {
    const { publicView, privateView, playerId } = state;
    const isMyTurn = publicView.currentPlayerId === playerId && !publicView.winnerPlayerId;
    const stoneLabel = privateView.stone ? `${privateView.stone} stone` : "spectator";
    statusEl.textContent = publicView.winnerPlayerId
      ? `${publicView.winnerPlayerId} won`
      : isMyTurn
        ? `Your turn (${stoneLabel})`
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
          client.sendAction({ type: "placeStone", payload: { x, y } });
        });
        boardElement.append(cell);
      }
    }
  }

  render();

  return {
    update(input) {
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
  if (!privateView.stone) {
    return false;
  }
  if (publicView.board[y]?.[x] !== null) {
    return false;
  }
  return !createsDoubleThree(publicView.board, x, y, privateView.stone);
}

function createsDoubleThree(board: GomokuCell[][], x: number, y: number, stone: GomokuStone): boolean {
  const nextBoard = board.map((row) => [...row]);
  nextBoard[y]![x] = stone;
  const openThreeCount = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ].filter(([dx, dy]) => isOpenThree(nextBoard, x, y, stone, dx!, dy!)).length;
  return openThreeCount >= 2;
}

function isOpenThree(board: GomokuCell[][], x: number, y: number, stone: GomokuStone, dx: number, dy: number): boolean {
  const line = collectLine(board, x, y, dx, dy);
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
      countLine(board, x, y, stone, dx, dy) === 3
    ) {
      return true;
    }
  }
  return false;
}

function collectLine(board: GomokuCell[][], x: number, y: number, dx: number, dy: number): Array<{ x: number; y: number; value: GomokuCell }> {
  const cells: Array<{ x: number; y: number; value: GomokuCell }> = [];
  let sx = x;
  let sy = y;
  while (board[sy - dy]?.[sx - dx] !== undefined) {
    sx -= dx;
    sy -= dy;
  }
  let cx = sx;
  let cy = sy;
  while (board[cy]?.[cx] !== undefined) {
    cells.push({ x: cx, y: cy, value: board[cy]![cx]! });
    cx += dx;
    cy += dy;
  }
  return cells;
}

function countLine(board: GomokuCell[][], x: number, y: number, stone: GomokuStone, dx: number, dy: number): number {
  return 1 + countDirection(board, x, y, stone, dx, dy) + countDirection(board, x, y, stone, -dx, -dy);
}

function countDirection(board: GomokuCell[][], x: number, y: number, stone: GomokuStone, dx: number, dy: number): number {
  let count = 0;
  let cx = x + dx;
  let cy = y + dy;
  while (board[cy]?.[cx] === stone) {
    count += 1;
    cx += dx;
    cy += dy;
  }
  return count;
}

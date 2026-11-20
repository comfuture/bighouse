import "./style.css";
import type { GameClientContext, GameClientSnapshot, MountedGameClient, PlayerSeat } from "@bighouse/game-sdk/client";
import { triggerPlacementFeedback } from "@bighouse/game-sdk/feedback";
import { createGameUi, type GameResultDialogState } from "@bighouse/ui";
import { placementProblem, type Board, type GomokuStatus, type Point, type Stone } from "./rules";
export { gameMetadata } from "./client-metadata";

type GomokuPublicView = {
  boardSize: number;
  board: Board;
  moveCount: number;
  status: GomokuStatus;
  lastMove?: Point & { playerId: string; stone: Stone };
};

type GomokuPrivateView = {
  stone?: Stone;
};

/** What the board needs from a host snapshot. */
type GomokuView = {
  playerId: string;
  version: number;
  serverTime: number;
  active: boolean;
  players: PlayerSeat[];
  publicView: GomokuPublicView;
  privateView: GomokuPrivateView;
};

export function mountGame(container: HTMLElement, context: GameClientContext): MountedGameClient {
  const board = createGomokuBoard(container, toGomokuView(context), (point) =>
    context.sendAction({ type: "placeStone", payload: point })
  );
  const gameUi = createGameUi(container, context, context);
  gameUi.setResult(gomokuResultDialogState(context));
  return {
    update(nextContext) {
      board.update(toGomokuView(nextContext));
      gameUi.update(nextContext);
      gameUi.setResult(gomokuResultDialogState(nextContext));
    },
    destroy() {
      gameUi.destroy();
      board.destroy();
    }
  };
}

function createGomokuBoard(
  container: HTMLElement,
  initialView: GomokuView,
  placeStone: (point: Point) => void
): { update(view: GomokuView): void; destroy(): void } {
  let view = initialView;
  // Local clock reading at which the current turn runs out, set from each fresh snapshot.
  let turnEndsAt = turnEndFor(view);
  let scrollFrame = 0;

  const surface = document.createElement("div");
  surface.className = "game-contained-surface gomoku-game";
  container.replaceChildren(surface);
  surface.innerHTML = `
    <div class="gomoku-status" data-role="status"></div>
    <div class="gomoku-stage" data-role="stage">
      <div class="gomoku-board" data-role="board" aria-label="Gomoku board"></div>
    </div>
  `;
  const statusElement = surface.querySelector<HTMLElement>("[data-role='status']")!;
  const stageElement = surface.querySelector<HTMLElement>("[data-role='stage']")!;
  const boardElement = surface.querySelector<HTMLElement>("[data-role='board']")!;

  function canPlace(x: number, y: number): boolean {
    const { publicView, privateView, playerId, active } = view;
    return (
      active &&
      publicView.status.kind === "playing" &&
      publicView.status.playerId === playerId &&
      privateView.stone !== undefined &&
      placementProblem(publicView.board, x, y, privateView.stone) === null
    );
  }

  function renderStatus(): void {
    statusElement.textContent = statusText(view, turnEndsAt);
  }

  function render(): void {
    const { publicView } = view;
    renderStatus();
    boardElement.style.setProperty("--board-size", String(publicView.boardSize));
    const scroll = { left: stageElement.scrollLeft, top: stageElement.scrollTop, x: window.scrollX, y: window.scrollY };
    boardElement.innerHTML = "";

    for (let y = 0; y < publicView.boardSize; y += 1) {
      for (let x = 0; x < publicView.boardSize; x += 1) {
        const cell = document.createElement("button");
        const value = publicView.board[y]?.[x] ?? null;
        const legal = canPlace(x, y);
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
          if (!canPlace(x, y)) return;
          triggerPlacementFeedback();
          placeStone({ x, y });
        });
        boardElement.append(cell);
      }
    }

    // Rebuilding the cells can move the scroll position; put it back now and after layout.
    const restore = (): void => {
      stageElement.scrollLeft = scroll.left;
      stageElement.scrollTop = scroll.top;
      window.scrollTo(scroll.x, scroll.y);
    };
    restore();
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(restore);
  }

  render();
  const countdown = window.setInterval(renderStatus, 500);

  return {
    update(next) {
      // The host also calls this for chat and presence with the same snapshot; only a new version changes the board.
      if (next.version === view.version) return;
      view = next;
      turnEndsAt = turnEndFor(view);
      render();
    },
    destroy() {
      window.clearInterval(countdown);
      cancelAnimationFrame(scrollFrame);
      surface.remove();
    }
  };
}

function preventButtonFocus(event: MouseEvent): void {
  event.preventDefault();
}

/** `performance.now()` value at which the turn deadline passes, or null when no turn is running. */
function turnEndFor(view: GomokuView): number | null {
  const { status } = view.publicView;
  if (!view.active || status.kind !== "playing") return null;
  return performance.now() + (status.deadline - view.serverTime);
}

function playerName(players: PlayerSeat[], playerId: string): string {
  return players.find((player) => player.playerId === playerId)?.displayName || "opponent";
}

function statusText(view: GomokuView, turnEndsAt: number | null): string {
  const { status } = view.publicView;
  switch (status.kind) {
    case "won":
      return status.winnerPlayerId === view.playerId ? "You Win!" : "You Lose!";
    case "draw":
      return "Draw";
    case "idle":
      return "Waiting for opponent";
    case "playing": {
      if (!view.active) return "Waiting for opponent";
      const seconds = turnEndsAt === null ? "" : ` · ${Math.max(0, Math.ceil((turnEndsAt - performance.now()) / 1000))}s`;
      if (status.playerId !== view.playerId) return `Waiting for ${playerName(view.players, status.playerId)}${seconds}`;
      return `Your turn (${view.privateView.stone ?? "black"} stone)${seconds}`;
    }
  }
}

function toGomokuView(context: GameClientSnapshot): GomokuView {
  return {
    playerId: context.playerId,
    version: context.version,
    serverTime: context.serverTime,
    active: context.phase === "active",
    players: context.room.players,
    publicView: context.publicView as GomokuPublicView,
    privateView: context.privateView as GomokuPrivateView
  };
}

function gomokuResultDialogState(context: GameClientSnapshot): GameResultDialogState {
  const { status } = context.publicView as GomokuPublicView;
  if (context.phase !== "finished" || (status.kind !== "won" && status.kind !== "draw")) {
    return { open: false, title: "", message: "" };
  }
  const iRequested = context.rematchRequests.includes(context.playerId);
  const opponentRequested = context.rematchRequests.some((playerId) => playerId !== context.playerId);
  return {
    open: true,
    kicker: status.kind === "draw" ? "No moves left" : "Five in a row",
    title: status.kind === "draw" ? "Draw" : status.winnerPlayerId === context.playerId ? "You Win!" : "You Lose!",
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

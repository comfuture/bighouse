import "./style.css";
import type { GameClientContext, GameClientSnapshot, MountedGameClient, PlayerSeat } from "@bighouse/game-sdk/client";
import { triggerPlacementFeedback } from "@bighouse/game-sdk/feedback";
import { createGameUi, type GameResultDialogState } from "@bighouse/ui";
import { GomokuAudioManager } from "./audio";
import { GomokuCanvasRenderer } from "./renderer";
import { placementProblem, type Board, type GomokuStatus, type Point, type Stone } from "./rules";
import { resolveTurnStone } from "./turn-stone";
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
  let turnChimeTimer: number | null = null;
  let hoveredCell: Point | null = null;
  let builtBoardSize = -1;
  let cells: HTMLButtonElement[] = [];
  let recentLocalPlacement: { key: string; at: number } | null = null;

  const audio = new GomokuAudioManager();

  const surface = document.createElement("div");
  surface.className = "game-contained-surface gomoku-game";
  container.replaceChildren(surface);
  surface.innerHTML = `
    <div class="gomoku-status" data-role="status">
      <div class="gomoku-status-main">
        <span class="gomoku-turn-stone" data-role="turn-stone" aria-hidden="true"></span>
        <span class="gomoku-status-text" data-role="status-text"></span>
      </div>
      <button type="button" class="gomoku-mute-toggle" data-role="mute-toggle"></button>
    </div>
    <div class="gomoku-stage" data-role="stage">
      <div class="gomoku-board" data-role="board" aria-label="Gomoku board"></div>
    </div>
  `;
  const statusTextElement = surface.querySelector<HTMLElement>("[data-role='status-text']")!;
  const turnStoneElement = surface.querySelector<HTMLElement>("[data-role='turn-stone']")!;
  const muteToggleButton = surface.querySelector<HTMLButtonElement>("[data-role='mute-toggle']")!;
  const stageElement = surface.querySelector<HTMLElement>("[data-role='stage']")!;
  const boardElement = surface.querySelector<HTMLElement>("[data-role='board']")!;

  const renderer = new GomokuCanvasRenderer(boardElement, {
    boardSize: view.publicView.boardSize,
    board: view.publicView.board,
    lastMove: view.publicView.lastMove,
    hoveredCell: null,
    hoverStone: null,
    won: view.publicView.status.kind === "won"
  });

  function syncMuteButton(): void {
    muteToggleButton.textContent = audio.muted ? "🔇 음소거" : "🔊 사운드";
    muteToggleButton.setAttribute("aria-label", audio.muted ? "사운드 켜기" : "사운드 끄기");
    muteToggleButton.classList.toggle("is-muted", audio.muted);
  }

  const unlockAudioOnGesture = (): void => {
    void audio.unlock();
  };
  surface.addEventListener("pointerdown", unlockAudioOnGesture, { capture: true, passive: true });
  surface.addEventListener("keydown", unlockAudioOnGesture, { capture: true, passive: true });

  muteToggleButton.addEventListener("mousedown", preventButtonFocus);
  muteToggleButton.addEventListener("click", (event) => {
    event.preventDefault();
    void audio.unlock();
    audio.toggleMute();
    syncMuteButton();
  });

  function isMyActiveTurn(v: GomokuView): boolean {
    return (
      v.active &&
      v.publicView.status.kind === "playing" &&
      v.publicView.status.playerId === v.playerId
    );
  }

  function canPlace(x: number, y: number): boolean {
    const { publicView, privateView } = view;
    return (
      isMyActiveTurn(view) &&
      privateView.stone !== undefined &&
      placementProblem(publicView.board, x, y, privateView.stone) === null
    );
  }

  function updateHover(nextCell: Point | null): void {
    hoveredCell = nextCell;
    const hoverStone =
      nextCell && canPlace(nextCell.x, nextCell.y) ? (view.privateView.stone ?? null) : null;
    renderer.setHover(hoverStone ? nextCell : null, hoverStone);
  }

  const onBoardPointerLeave = (): void => {
    updateHover(null);
  };
  boardElement.addEventListener("pointerleave", onBoardPointerLeave);

  // Disabled buttons do not emit click events; provide subtle forbidden wood-knock on blocked cells during your turn.
  const onBoardPointerDown = (event: PointerEvent): void => {
    if (!isMyActiveTurn(view)) return;
    const target = event.target as HTMLElement | null;
    if (!target || !target.classList.contains("gomoku-cell")) return;
    if (target.classList.contains("is-blocked")) {
      void audio.unlock();
      audio.playSfx("sfx_forbidden");
    }
  };
  boardElement.addEventListener("pointerdown", onBoardPointerDown);

  function renderStatus(): void {
    statusTextElement.textContent = statusText(view, turnEndsAt);
    const activeStone = currentTurnStone(view);
    turnStoneElement.className = activeStone
      ? `gomoku-turn-stone is-${activeStone}`
      : "gomoku-turn-stone is-hidden";
  }

  function rebuildCells(boardSize: number): void {
    const scroll = { left: stageElement.scrollLeft, top: stageElement.scrollTop, x: window.scrollX, y: window.scrollY };
    for (const existing of cells) {
      existing.remove();
    }
    cells = [];
    renderer.ensureMounted();

    const fragment = document.createDocumentFragment();
    for (let y = 0; y < boardSize; y += 1) {
      for (let x = 0; x < boardSize; x += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.dataset.gameElastic = "off";
        cell.addEventListener("mousedown", preventButtonFocus);
        cell.addEventListener("pointerenter", () => updateHover({ x, y }));
        cell.addEventListener("focus", () => updateHover({ x, y }));
        cell.addEventListener("blur", () => {
          if (hoveredCell?.x === x && hoveredCell.y === y) {
            updateHover(null);
          }
        });
        cell.addEventListener("click", (event) => {
          event.preventDefault();
          cell.blur();
          void audio.unlock();
          if (!canPlace(x, y)) {
            if (isMyActiveTurn(view)) {
              audio.playSfx("sfx_forbidden");
            }
            return;
          }
          const myStone = view.privateView.stone ?? "black";
          recentLocalPlacement = { key: `${x},${y}`, at: performance.now() };
          triggerPlacementFeedback();
          audio.playSfx("sfx_stone_place");
          renderer.notifyStonePlaced(x, y, myStone);
          updateHover(null);
          placeStone({ x, y });
        });
        cells.push(cell);
        fragment.append(cell);
      }
    }
    boardElement.append(fragment);
    builtBoardSize = boardSize;

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

  function render(): void {
    const { publicView } = view;
    renderStatus();
    boardElement.style.setProperty("--board-size", String(publicView.boardSize));

    if (builtBoardSize !== publicView.boardSize) {
      rebuildCells(publicView.boardSize);
    }

    let idx = 0;
    for (let y = 0; y < publicView.boardSize; y += 1) {
      for (let x = 0; x < publicView.boardSize; x += 1) {
        const cell = cells[idx++];
        if (!cell) continue;
        const value = publicView.board[y]?.[x] ?? null;
        const legal = canPlace(x, y);
        const isLast = publicView.lastMove?.x === x && publicView.lastMove.y === y;
        cell.className = [
          "gomoku-cell",
          value ? `is-${value}` : "is-empty",
          legal ? "is-legal" : "is-blocked",
          isLast ? "is-last" : ""
        ].join(" ");
        cell.disabled = !legal;
        cell.ariaLabel = value ? `${value} stone at ${x + 1}, ${y + 1}` : `empty ${x + 1}, ${y + 1}`;
      }
    }

    const hoverStone =
      hoveredCell && canPlace(hoveredCell.x, hoveredCell.y) ? (view.privateView.stone ?? null) : null;
    renderer.setState({
      boardSize: publicView.boardSize,
      board: publicView.board,
      lastMove: publicView.lastMove,
      hoveredCell: hoverStone ? hoveredCell : null,
      hoverStone,
      won: publicView.status.kind === "won"
    });
  }

  syncMuteButton();
  render();
  const countdown = window.setInterval(renderStatus, 500);

  return {
    update(next) {
      // The host also calls this for chat and presence with the same snapshot; only a new version changes the board.
      if (next.version === view.version) return;
      const prev = view;
      view = next;
      turnEndsAt = turnEndFor(view);

      if (next.publicView.moveCount === 0) {
        recentLocalPlacement = null;
      }

      // Detect newly added stones (both own and opponent's)
      const addedStones = diffAddedStones(prev.publicView.board, next.publicView.board);
      let playedStoneSound = false;
      const now = performance.now();
      for (const added of addedStones) {
        const key = `${added.x},${added.y}`;
        const wasJustLocal =
          recentLocalPlacement !== null &&
          recentLocalPlacement.key === key &&
          now - recentLocalPlacement.at < 2000;
        if (wasJustLocal) {
          recentLocalPlacement = null;
          continue;
        }
        renderer.notifyStonePlaced(added.x, added.y, added.stone);
        if (!playedStoneSound) {
          audio.playSfx("sfx_stone_place");
          playedStoneSound = true;
        }
      }

      // Detect game completion SFX
      const prevKind = prev.publicView.status.kind;
      const nextStatus = next.publicView.status;
      if (prevKind !== nextStatus.kind) {
        if (nextStatus.kind === "won") {
          audio.playSfx(nextStatus.winnerPlayerId === next.playerId ? "sfx_win" : "sfx_lose");
        } else if (nextStatus.kind === "draw") {
          audio.playSfx("sfx_draw");
        }
      }

      // Detect transition into our active turn
      const wasMyTurn = isMyActiveTurn(prev);
      const isNowMyTurn = isMyActiveTurn(next);
      if (!wasMyTurn && isNowMyTurn) {
        if (turnChimeTimer !== null) {
          window.clearTimeout(turnChimeTimer);
          turnChimeTimer = null;
        }
        const delayMs = playedStoneSound ? 180 : 0;
        if (delayMs > 0) {
          turnChimeTimer = window.setTimeout(() => {
            turnChimeTimer = null;
            audio.playSfx("sfx_turn_chime");
          }, delayMs);
        } else {
          audio.playSfx("sfx_turn_chime");
        }
      }

      render();
    },
    destroy() {
      window.clearInterval(countdown);
      if (turnChimeTimer !== null) {
        window.clearTimeout(turnChimeTimer);
        turnChimeTimer = null;
      }
      cancelAnimationFrame(scrollFrame);
      surface.removeEventListener("pointerdown", unlockAudioOnGesture, { capture: true });
      surface.removeEventListener("keydown", unlockAudioOnGesture, { capture: true });
      boardElement.removeEventListener("pointerleave", onBoardPointerLeave);
      boardElement.removeEventListener("pointerdown", onBoardPointerDown);
      renderer.destroy();
      audio.destroy();
      surface.remove();
    }
  };
}

function diffAddedStones(prevBoard: Board, nextBoard: Board): Array<Point & { stone: Stone }> {
  const added: Array<Point & { stone: Stone }> = [];
  if (prevBoard.length !== nextBoard.length) return added;
  for (let y = 0; y < nextBoard.length; y += 1) {
    const prevRow = prevBoard[y];
    const nextRow = nextBoard[y];
    if (!prevRow || !nextRow || prevRow.length !== nextRow.length) continue;
    for (let x = 0; x < nextRow.length; x += 1) {
      const nextStone = nextRow[x];
      if (prevRow[x] === null && (nextStone === "black" || nextStone === "white")) {
        added.push({ x, y, stone: nextStone });
      }
    }
  }
  return added;
}

function currentTurnStone(view: GomokuView): Stone | null {
  return resolveTurnStone({
    active: view.active,
    status: view.publicView.status,
    playerId: view.playerId,
    myStone: view.privateView.stone,
    players: view.players
  });
}

function preventButtonFocus(event: MouseEvent): void {
  event.preventDefault();
}

/** `performance.now()` value at which the turn deadline passes, or null when no turn is running. */
function turnEndFor(view: GomokuView): number | null {
  const { status } = view.publicView;
  if (!view.active || status.kind !== "playing" || status.deadline === null) return null;
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

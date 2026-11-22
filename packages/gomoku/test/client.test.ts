import { cloneState, type RoomState } from "@bighouse/game-sdk/server";
import { describe, expect, it } from "vitest";
import { resolveTurnStone } from "../src/turn-stone";
import type { GomokuStatus, Stone } from "../src/rules";
import { gomokuDefinition } from "../src/server";

function startedState(): RoomState {
  const state: RoomState = {
    room: {
      roomId: "room_turn_stone",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2,
      config: {},
      createdAt: 1
    },
    phase: "active",
    version: 2,
    players: [
      { playerId: "p1", seat: 0, connected: true, ready: true, joinedAt: 1 },
      { playerId: "p2", seat: 1, connected: true, ready: true, joinedAt: 1 }
    ],
    stageState: {},
    playerStates: {},
    updatedAt: 1
  };
  state.stageState = gomokuDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
  state.playerStates.p1 = gomokuDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
  state.playerStates.p2 = gomokuDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });
  return state;
}

describe("resolveTurnStone", () => {
  it("shows White's stone on Black's client after Black's opening turn times out with moveCount still 0", () => {
    const initial = startedState();
    const timedOut = gomokuDefinition.applyTimer!(
      { state: cloneState(initial), now: 30_001 },
      { id: "turn-timeout", kind: "turn_timeout", runAt: 30_001 }
    ).state;

    const publicView = gomokuDefinition.getPublicView({ state: timedOut, now: 30_001 }) as {
      moveCount: number;
      status: GomokuStatus;
    };
    const blackPrivate = gomokuDefinition.getPrivateView({ state: timedOut, now: 30_001 }, "p1") as {
      stone?: Stone;
    };
    const whitePrivate = gomokuDefinition.getPrivateView({ state: timedOut, now: 30_001 }, "p2") as {
      stone?: Stone;
    };

    // Timeout passed turn to p2 without incrementing moveCount
    expect(publicView.moveCount).toBe(0);
    expect(publicView.status).toMatchObject({ kind: "playing", playerId: "p2" });

    // Black's client must display White's stone while waiting for p2
    expect(
      resolveTurnStone({
        active: true,
        status: publicView.status,
        playerId: "p1",
        myStone: blackPrivate.stone,
        players: timedOut.players
      })
    ).toBe("white");

    // White's client displays White's stone on its own turn
    expect(
      resolveTurnStone({
        active: true,
        status: publicView.status,
        playerId: "p2",
        myStone: whitePrivate.stone,
        players: timedOut.players
      })
    ).toBe("white");

    // Spectator without an assigned stone still resolves White via seat order
    expect(
      resolveTurnStone({
        active: true,
        status: publicView.status,
        playerId: "spectator",
        myStone: undefined,
        players: timedOut.players
      })
    ).toBe("white");
  });

  it("returns null when game is not actively playing", () => {
    const players = [
      { playerId: "p1", seat: 0 },
      { playerId: "p2", seat: 1 }
    ];
    expect(
      resolveTurnStone({
        active: false,
        status: { kind: "playing", playerId: "p1", deadline: null },
        playerId: "p1",
        myStone: "black",
        players
      })
    ).toBeNull();
    expect(
      resolveTurnStone({
        active: true,
        status: { kind: "won", winnerPlayerId: "p1" },
        playerId: "p1",
        myStone: "black",
        players
      })
    ).toBeNull();
    expect(
      resolveTurnStone({
        active: true,
        status: { kind: "draw" },
        playerId: "p1",
        myStone: "black",
        players
      })
    ).toBeNull();
  });
});

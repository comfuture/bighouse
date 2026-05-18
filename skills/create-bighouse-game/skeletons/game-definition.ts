import type {
  ActionResult,
  ClientGameAction,
  GameContext,
  GameDefinition,
  GameEvent,
  JsonObject,
  PlayerSeat,
  ValidationResult
} from "../core/game";
import { createId } from "../core/ids";

type __PASCAL__StageState = {
  currentPlayerId?: string;
  winnerPlayerId?: string;
};

type __PASCAL__PlayerState = {
  ready: boolean;
};

export const __CAMEL__Definition: GameDefinition = {
  gameId: "__GAME_ID__",
  adapterKey: "__GAME_ID__",
  displayName: "__DISPLAY_NAME__",
  minPlayers: 2,
  maxPlayers: 2,

  initialStageState(): JsonObject {
    return {} satisfies __PASCAL__StageState;
  },

  initialPlayerState(_player: PlayerSeat): JsonObject {
    return { ready: true } satisfies __PASCAL__PlayerState;
  },

  validateAction(context: GameContext, action: ClientGameAction): ValidationResult {
    if (action.type !== "exampleAction") {
      return { ok: false, code: "invalid_action", message: "Unsupported __DISPLAY_NAME__ action" };
    }
    const stage = readStage(context.state.stageState);
    if (stage.winnerPlayerId) {
      return { ok: false, code: "invalid_action", message: "Game already has a winner" };
    }
    const currentPlayerId = stage.currentPlayerId ?? context.state.players[0]?.playerId;
    if (action.playerId !== currentPlayerId) {
      return { ok: false, code: "invalid_turn", message: "It is not this player's turn" };
    }
    return { ok: true };
  },

  applyAction(context: GameContext, action: ClientGameAction): ActionResult {
    const state = context.state;
    const stage = readStage(state.stageState);
    const next = nextPlayer(state.players, action.playerId);
    if (next) {
      stage.currentPlayerId = next.playerId;
    }
    state.stageState = stage as unknown as JsonObject;

    const events: GameEvent[] = [
      {
        id: createId("evt"),
        type: "__GAME_ID__.exampleAction",
        visibility: "public",
        payload: { playerId: action.playerId },
        createdAt: context.now
      }
    ];

    return { state, events };
  },

  getPublicView(context: GameContext): JsonObject {
    const stage = readStage(context.state.stageState);
    return {
      currentPlayerId: stage.currentPlayerId ?? context.state.players[0]?.playerId,
      winnerPlayerId: stage.winnerPlayerId
    };
  },

  getPrivateView(context: GameContext, playerId: string): JsonObject {
    return context.state.playerStates[playerId] ?? {};
  },

  nextTimers() {
    return [];
  }
};

function readStage(value: JsonObject): __PASCAL__StageState {
  return value as unknown as __PASCAL__StageState;
}

function nextPlayer(players: PlayerSeat[], currentPlayerId: string): PlayerSeat | undefined {
  const currentIndex = players.findIndex((player) => player.playerId === currentPlayerId);
  if (currentIndex < 0 || players.length === 0) {
    return players[0];
  }
  return players[(currentIndex + 1) % players.length];
}

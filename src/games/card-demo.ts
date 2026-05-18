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

type CardStageState = {
  discardPile: string[];
  deckCount: number;
  currentPlayerId?: string;
  round: number;
};

type CardPlayerState = {
  hand: string[];
};

const initialHands = [
  ["AS", "7H", "3C"],
  ["KD", "5S", "2H"],
  ["QC", "8D", "4S"],
  ["JH", "9C", "6D"]
];

export const cardDemoDefinition: GameDefinition = {
  gameId: "card-demo",
  adapterKey: "card-demo",
  displayName: "Card Demo",
  minPlayers: 2,
  maxPlayers: 4,

  initialStageState(): JsonObject {
    return {
      discardPile: [],
      deckCount: 40,
      round: 1
    } satisfies CardStageState;
  },

  initialPlayerState(player: PlayerSeat): JsonObject {
    return { hand: [...(initialHands[player.seat] ?? ["10S", "10H", "10D"])] } satisfies CardPlayerState;
  },

  validateAction(context: GameContext, action: ClientGameAction): ValidationResult {
    const stage = cardStage(context.state.stageState);
    const currentPlayerId = stage.currentPlayerId ?? context.state.players[0]?.playerId;
    if (action.playerId !== currentPlayerId) {
      return { ok: false, code: "invalid_turn", message: "It is not this player's turn" };
    }
    if (action.type === "playCard") {
      const card = String(action.payload.card ?? "");
      if (!card) {
        return { ok: false, code: "invalid_action", message: "card is required" };
      }
      if (!cardPlayer(context.state.playerStates[action.playerId]).hand.includes(card)) {
        return { ok: false, code: "invalid_action", message: "Player does not hold that card" };
      }
      return { ok: true };
    }
    if (action.type === "drawCard") {
      if (stage.deckCount <= 0) {
        return { ok: false, code: "invalid_action", message: "Deck is empty" };
      }
      return { ok: true };
    }
    return { ok: false, code: "invalid_action", message: "Unsupported card demo action" };
  },

  applyAction(context: GameContext, action: ClientGameAction): ActionResult {
    const state = context.state;
    const stage = cardStage(state.stageState);
    const playerState = cardPlayer(state.playerStates[action.playerId]);
    const events: GameEvent[] = [];

    if (action.type === "playCard") {
      const card = String(action.payload.card);
      playerState.hand = playerState.hand.filter((held) => held !== card);
      stage.discardPile.push(card);
      events.push({
        id: createId("evt"),
        type: "card.played",
        visibility: "public",
        payload: { playerId: action.playerId, card },
        createdAt: context.now
      });
    }

    if (action.type === "drawCard") {
      const card = `D${stage.deckCount}`;
      stage.deckCount -= 1;
      playerState.hand.push(card);
      events.push({
        id: createId("evt"),
        type: "card.drawn",
        visibility: "private",
        playerId: action.playerId,
        payload: { card },
        createdAt: context.now
      });
    }

    const next = nextPlayer(state.players, action.playerId);
    if (next) {
      stage.currentPlayerId = next.playerId;
    }
    if (next?.seat === 0) {
      stage.round += 1;
    }
    state.stageState = stage as unknown as JsonObject;
    state.playerStates[action.playerId] = playerState as unknown as JsonObject;
    return { state, events };
  },

  getPublicView(context: GameContext): JsonObject {
    const stage = cardStage(context.state.stageState);
    return {
      discardPile: stage.discardPile,
      deckCount: stage.deckCount,
      currentPlayerId: stage.currentPlayerId ?? context.state.players[0]?.playerId,
      round: stage.round,
      hands: Object.fromEntries(
        context.state.players.map((player) => [
          player.playerId,
          { count: cardPlayer(context.state.playerStates[player.playerId]).hand.length }
        ])
      )
    };
  },

  getPrivateView(context: GameContext, playerId: string): JsonObject {
    return cardPlayer(context.state.playerStates[playerId]) as unknown as JsonObject;
  },

  nextTimers() {
    return [];
  }
};

function cardStage(value: JsonObject): CardStageState {
  return value as unknown as CardStageState;
}

function cardPlayer(value: JsonObject | undefined): CardPlayerState {
  return (value ?? { hand: [] }) as unknown as CardPlayerState;
}

function nextPlayer(players: PlayerSeat[], currentPlayerId: string): PlayerSeat | undefined {
  const currentIndex = players.findIndex((player) => player.playerId === currentPlayerId);
  if (currentIndex < 0 || players.length === 0) {
    return players[0];
  }
  return players[(currentIndex + 1) % players.length];
}

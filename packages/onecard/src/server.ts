import type {
  ActionResult,
  BotGameContext,
  ClientGameAction,
  GameAction,
  GameContext,
  GameEvent,
  JsonObject,
  PlayerSeat,
  ServerGamePlugin,
  ValidationResult
} from "@bighouse/game-sdk/server";
import { createGameEventId, defineGameDefinition, secureShuffle } from "@bighouse/game-sdk/server";
import { baseGameMetadata } from "./metadata";
import { cardPlayProblem } from "./rules";

export type CardStageState = {
  discardPile: string[];
  deck: string[];
  /** Opening hands by player id, written once per deal. Never sent to clients. */
  dealtHands: Record<string, string[]>;
  currentPlayerId?: string;
  turnDirection: "clockwise" | "counterclockwise";
  activeAttackCount: number;
  activeAttackCard?: string;
  chosenSuit?: "S" | "H" | "C" | "D";
  winnerPlayerId?: string;
  eliminatedPlayerIds: string[];
  hasExtraTurn: boolean;
};

export type CardPlayerState = {
  hand: string[];
};

export const gameMetadata = baseGameMetadata;

const HAND_SIZE = 7;
/** A player holding this many cards is out of the game. */
const BANKRUPT_HAND_SIZE = 16;

function generateDeck(): string[] {
  const suits = ["S", "H", "C", "D"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const deck: string[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(rank + suit);
    }
  }
  deck.push("BJ", "CJ");
  return deck;
}

export const oneCardDefinition = defineGameDefinition(gameMetadata, {
  initialStageState(context): JsonObject {
    const base = {
      discardPile: [],
      deck: [],
      dealtHands: {},
      turnDirection: "clockwise",
      activeAttackCount: 0,
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    } satisfies CardStageState;
    const firstPlayer = context.players[0];
    if (!firstPlayer) {
      return base;
    }

    // Every game is dealt from a fresh, unpredictable shuffle. The hands are
    // parked in the stage because initialPlayerState runs once per seat afterwards.
    const deck = secureShuffle(generateDeck());
    const dealtHands = Object.fromEntries(
      context.players.map((player) => [player.playerId, deck.splice(deck.length - HAND_SIZE, HAND_SIZE)])
    );
    // The open card is the first one that is not a Joker.
    const openIndex = deck.findIndex((card) => card !== "BJ" && card !== "CJ");
    const [openCard] = deck.splice(openIndex, 1);

    return {
      ...base,
      discardPile: [openCard!],
      deck,
      dealtHands,
      currentPlayerId: firstPlayer.playerId
    } satisfies CardStageState;
  },

  initialPlayerState(player, context): JsonObject {
    const dealtHands = (context.stageState as Partial<CardStageState> | undefined)?.dealtHands;
    return { hand: [...(dealtHands?.[player.playerId] ?? [])] } satisfies CardPlayerState;
  },

  validateAction(context: GameContext, action: ClientGameAction): ValidationResult {
    const stage = readStage(context.state.stageState);
    if (stage.winnerPlayerId) {
      return { ok: false, code: "invalid_action", message: "Game already has a winner" };
    }
    const currentPlayerId = stage.currentPlayerId ?? context.state.players[0]?.playerId;
    if (action.playerId !== currentPlayerId) {
      return { ok: false, code: "invalid_turn", message: "It is not this player's turn" };
    }

    if (action.type === "playCard") {
      const card = String(action.payload.card ?? "");
      if (!card) {
        return { ok: false, code: "invalid_action", message: "card is required" };
      }
      const chosenSuit = action.payload.chosenSuit;
      if (chosenSuit !== undefined && !isSuit(chosenSuit)) {
        return { ok: false, code: "invalid_action", message: "chosenSuit must be S, H, C, or D" };
      }
      if (chosenSuit !== undefined && !canChooseSuit(card)) {
        return { ok: false, code: "invalid_action", message: "Only a 7 or Joker can choose a suit" };
      }
      const playerState = readPlayer(context.state.playerStates[action.playerId]);
      if (!playerState.hand.includes(card)) {
        return { ok: false, code: "invalid_action", message: "Player does not hold that card" };
      }

      // Check playability rule
      const validation = validateCardPlay(stage, card);
      if (!validation.ok) {
        return validation;
      }
      if (chosenSuit === undefined && canChooseSuit(card)) {
        return { ok: false, code: "invalid_action", message: "chosenSuit is required for a 7 or Joker" };
      }
      return { ok: true };
    }

    if (action.type === "drawCard") {
      return { ok: true };
    }

    if (action.type === "pass") {
      if (!stage.hasExtraTurn) {
        return { ok: false, code: "invalid_action", message: "Cannot pass unless you played a King" };
      }
      return { ok: true };
    }

    return { ok: false, code: "invalid_action", message: "Unsupported One Card action" };
  },

  applyAction(context: GameContext, action: ClientGameAction): ActionResult {
    const state = context.state;
    const stage = readStage(state.stageState);
    const playerState = readPlayer(state.playerStates[action.playerId]);
    const events: GameEvent[] = [];

    if (action.type === "playCard") {
      const card = String(action.payload.card);
      const chosenSuit = isSuit(action.payload.chosenSuit) ? action.payload.chosenSuit : undefined;

      // Remove from hand
      playerState.hand = playerState.hand.filter((held) => held !== card);
      stage.discardPile.push(card);

      // Check if Joker
      const isBJ = card === "BJ";
      const isCJ = card === "CJ";
      const suit = isBJ || isCJ ? "J" : card.slice(-1) as "S" | "H" | "C" | "D";
      const rank = isBJ || isCJ ? card : card.slice(0, -1);

      // Set wild suit choice
      if (isBJ || isCJ || rank === "7") {
        if (!chosenSuit) {
          throw new Error("chosenSuit must be validated before applying a 7 or Joker");
        }
        stage.chosenSuit = chosenSuit;
      } else {
        // Clear chosenSuit if a matching standard card is played
        delete stage.chosenSuit;
      }

      // Check attack triggers
      let attackValue = 0;
      if (rank === "2") {
        attackValue = 2;
      } else if (rank === "A") {
        attackValue = suit === "S" ? 5 : 3;
      } else if (isBJ) {
        attackValue = 5;
      } else if (isCJ) {
        attackValue = 7;
      }

      if (attackValue > 0) {
        stage.activeAttackCount += attackValue;
        stage.activeAttackCard = card;
      }

      // Emit played event
      events.push({
        id: createGameEventId(),
        type: "onecard.cardPlayed",
        visibility: "public",
        payload: {
          playerId: action.playerId,
          card,
          chosenSuit: stage.chosenSuit,
          activeAttackCount: stage.activeAttackCount
        },
        createdAt: context.now
      });

      // Special action cards: J (skip), Q (reverse), K (extra turn)
      let skipNext = false;
      if (rank === "J") {
        skipNext = true;
      } else if (rank === "Q") {
        stage.turnDirection = stage.turnDirection === "clockwise" ? "counterclockwise" : "clockwise";
      } else if (rank === "K") {
        stage.hasExtraTurn = true;
      }

      // Check Win
      if (playerState.hand.length === 0) {
        stage.winnerPlayerId = action.playerId;
        state.phase = "finished";
        events.push({
          id: createGameEventId(),
          type: "onecard.gameWon",
          visibility: "system",
          payload: { winnerPlayerId: action.playerId },
          createdAt: context.now
        });
      } else {
        // Advance turn if not King or player won
        if (rank === "K") {
          // Extra turn! Player remains active
        } else {
          stage.hasExtraTurn = false;
          stage.currentPlayerId = nextPlayerId(state.players, stage, skipNext);
        }
      }
    }

    if (action.type === "drawCard") {
      const isAttackActive = stage.activeAttackCount > 0;
      const cardsToDraw = isAttackActive ? stage.activeAttackCount : 1;
      const drawnCards: string[] = [];

      for (let i = 0; i < cardsToDraw; i++) {
        if (stage.deck.length === 0) {
          // Recycle deck
          const recycled = stage.discardPile.slice(0, -1);
          if (recycled.length > 0) {
            stage.deck = secureShuffle(recycled);
            stage.discardPile = [stage.discardPile[stage.discardPile.length - 1]!];
            events.push({
              id: createGameEventId(),
              type: "onecard.deckRecycled",
              visibility: "public",
              payload: { deckCount: stage.deck.length },
              createdAt: context.now
            });
          } else {
            // Absolutely no cards left to recycle
            break;
          }
        }
        if (stage.deck.length > 0) {
          const card = stage.deck.pop()!;
          drawnCards.push(card);
        }
      }

      playerState.hand.push(...drawnCards);

      // Broadcast draw event privately to drawer
      events.push({
        id: createGameEventId(),
        type: "onecard.cardDrawn",
        visibility: "private",
        playerId: action.playerId,
        payload: { cards: drawnCards },
        createdAt: context.now
      });

      // Broadcast public card counts summary
      events.push({
        id: createGameEventId(),
        type: "onecard.playerDrawnCount",
        visibility: "public",
        payload: {
          playerId: action.playerId,
          count: drawnCards.length,
          handCount: playerState.hand.length,
          wasAttack: isAttackActive
        },
        createdAt: context.now
      });

      // Check Bankruptcy (Hand length >= 16)
      if (playerState.hand.length >= BANKRUPT_HAND_SIZE) {
        stage.eliminatedPlayerIds.push(action.playerId);
        events.push({
          id: createGameEventId(),
          type: "onecard.playerBankrupt",
          visibility: "public",
          payload: { playerId: action.playerId, handCount: playerState.hand.length },
          createdAt: context.now
        });

        // Check if only 1 active player remains
        const activePlayers = state.players.filter((p) => !stage.eliminatedPlayerIds.includes(p.playerId));
        if (activePlayers.length <= 1) {
          const lastPlayer = activePlayers[0] ?? state.players.find((p) => p.playerId !== action.playerId);
          if (lastPlayer) {
            stage.winnerPlayerId = lastPlayer.playerId;
            state.phase = "finished";
            events.push({
              id: createGameEventId(),
              type: "onecard.gameWon",
              visibility: "system",
              payload: { winnerPlayerId: lastPlayer.playerId },
              createdAt: context.now
            });
          }
        }
      }

      // Reset attacks and advance turn
      stage.activeAttackCount = 0;
      delete stage.activeAttackCard;
      stage.hasExtraTurn = false;

      if (state.phase !== "finished") {
        stage.currentPlayerId = nextPlayerId(state.players, stage, false);
      }
    }

    if (action.type === "pass") {
      stage.hasExtraTurn = false;
      stage.currentPlayerId = nextPlayerId(state.players, stage, false);
      events.push({
        id: createGameEventId(),
        type: "onecard.passed",
        visibility: "public",
        payload: { playerId: action.playerId },
        createdAt: context.now
      });
    }

    state.stageState = stage as unknown as JsonObject;
    state.playerStates[action.playerId] = playerState as unknown as JsonObject;

    return { state, events };
  },

  getPublicView(context: GameContext): JsonObject {
    const stage = readStage(context.state.stageState);
    const showTable = context.state.phase === "active" || context.state.phase === "finished";
    return {
      discardPile: showTable ? stage.discardPile : [],
      deckCount: showTable ? stage.deck.length : 0,
      currentPlayerId: showTable ? stage.currentPlayerId ?? context.state.players[0]?.playerId : undefined,
      turnDirection: stage.turnDirection,
      activeAttackCount: showTable ? stage.activeAttackCount : 0,
      activeAttackCard: showTable ? stage.activeAttackCard : undefined,
      chosenSuit: showTable ? stage.chosenSuit : undefined,
      winnerPlayerId: stage.winnerPlayerId,
      eliminatedPlayerIds: stage.eliminatedPlayerIds,
      hasExtraTurn: showTable ? stage.hasExtraTurn : false,
      hands: Object.fromEntries(
        context.state.players.map((player) => [
          player.playerId,
          { count: showTable ? readPlayer(context.state.playerStates[player.playerId]).hand.length : 0 }
        ])
      )
    };
  },

  getPrivateView(context: GameContext, playerId: string): JsonObject {
    if (context.state.phase !== "active" && context.state.phase !== "finished") {
      return { hand: [] } satisfies CardPlayerState;
    }
    return readPlayer(context.state.playerStates[playerId]);
  },

  nextTimers() {
    return [];
  },

  selectBotAction(context: BotGameContext): GameAction | null {
    return selectOneCardBotAction(context);
  }
});

export const oneCardGamePlugin = {
  gameMetadata,
  gameDefinition: oneCardDefinition
} satisfies ServerGamePlugin;

function selectOneCardBotAction(context: BotGameContext): GameAction | null {
  const stage = readStage(context.state.stageState);
  const playerState = readPlayer(context.state.playerStates[context.player.playerId]);
  const currentPlayerId = stage.currentPlayerId ?? context.state.players[0]?.playerId;
  if (context.state.phase !== "active" || stage.winnerPlayerId || currentPlayerId !== context.player.playerId) {
    return null;
  }
  if (stage.eliminatedPlayerIds.includes(context.player.playerId)) {
    return null;
  }

  const playableCards = playerState.hand.filter((card) => validateCardPlay(stage, card).ok);
  if (stage.activeAttackCount > 0) {
    const defenseCard = chooseDefenseCard(stage, playableCards, context);
    return defenseCard ? playCardAction(defenseCard, playerState.hand) : { type: "drawCard", payload: {} };
  }

  if (playableCards.length === 0) {
    return stage.hasExtraTurn ? { type: "pass", payload: {} } : { type: "drawCard", payload: {} };
  }

  const seed = `${context.state.room.roomId}:${context.state.version}:${context.player.playerId}`;
  const selected =
    context.difficulty === "low"
      ? pickOneCardLow(playableCards, seed)
      : chooseScoredCard(stage, playerState.hand, playableCards, context, seed);
  if (!selected) {
    return stage.hasExtraTurn ? { type: "pass", payload: {} } : { type: "drawCard", payload: {} };
  }
  return playCardAction(selected, playerState.hand);
}

function chooseDefenseCard(stage: CardStageState, playableCards: string[], context: BotGameContext): string | undefined {
  const ranked = playableCards
    .map((card) => ({
      card,
      score: defenseCardScore(stage, card, context.difficulty)
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.card;
}

function defenseCardScore(stage: CardStageState, card: string, difficulty: "low" | "medium" | "high"): number {
  const attack = attackValue(card);
  const rank = cardRank(card);
  let score = attack * 20;
  if (difficulty !== "high" && card === "CJ" && stage.activeAttackCard !== "BJ") {
    score -= 70;
  }
  if (difficulty === "low") {
    score += cardRankOrder(rank);
  }
  return score;
}

function pickOneCardLow(cards: string[], seed: string): string {
  const index = Math.floor(stableCardNoise(seed, "low") * cards.length) % cards.length;
  return cards[index]!;
}

function chooseScoredCard(
  stage: CardStageState,
  hand: string[],
  playableCards: string[],
  context: BotGameContext,
  seed: string
): string | undefined {
  const attackChance = context.difficulty === "high" ? 0.7 : 0.45;
  const shouldAttack = stableCardNoise(seed, "attack") < attackChance;
  const nextOpponentPressure = nextPlayerHandCount(context, stage);
  return playableCards
    .map((card) => ({
      card,
      score: normalCardScore(stage, hand, card, shouldAttack, nextOpponentPressure, context.difficulty) + stableCardNoise(seed, card)
    }))
    .sort((a, b) => b.score - a.score)[0]?.card;
}

function normalCardScore(
  stage: CardStageState,
  hand: string[],
  card: string,
  shouldAttack: boolean,
  nextOpponentHandCount: number | undefined,
  difficulty: "low" | "medium" | "high"
): number {
  const remainingCount = hand.length - 1;
  if (remainingCount === 0) {
    return 100_000;
  }

  const rank = cardRank(card);
  const attack = attackValue(card);
  const shouldSpendAttack =
    shouldAttack && (difficulty === "high" || (nextOpponentHandCount !== undefined && nextOpponentHandCount <= 2));
  let score = 100 - remainingCount * 8 + cardRankOrder(rank);
  if (attack > 0) {
    score += shouldSpendAttack ? attack * 24 : -attack * 60;
    if (nextOpponentHandCount !== undefined && nextOpponentHandCount <= 2) {
      score += attack * 18;
    }
  }
  if (rank === "J") {
    score += difficulty === "high" ? 45 : 25;
  }
  if (rank === "Q") {
    score += difficulty === "high" ? 32 : 18;
  }
  if (rank === "K") {
    score += hasNonAttackFollowUp(stage, hand, card) ? 55 : 12;
  }
  if (rank === "7") {
    score += 22 + majoritySuitCount(hand.filter((held) => held !== card)) * 6;
  }
  if (card === "CJ" && !shouldAttack) {
    score -= 80;
  } else if (card === "BJ" && !shouldAttack) {
    score -= 55;
  }
  if (rank === "A" && !shouldAttack) {
    score -= 35;
  }
  return score;
}

function playCardAction(card: string, hand: string[]): GameAction {
  return canChooseSuit(card)
    ? { type: "playCard", payload: { card, chosenSuit: chooseSuitForCard(card, hand) } }
    : { type: "playCard", payload: { card } };
}

function chooseSuitForCard(card: string, hand: string[]): "S" | "H" | "C" | "D" {
  const remaining = hand.filter((held) => held !== card);
  const counts = new Map<"S" | "H" | "C" | "D", number>([
    ["S", 0],
    ["H", 0],
    ["C", 0],
    ["D", 0]
  ]);
  for (const held of remaining) {
    const suit = cardSuit(held);
    if (suit !== "J") {
      counts.set(suit, (counts.get(suit) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "S";
}

function nextPlayerHandCount(context: BotGameContext, stage: CardStageState): number | undefined {
  const nextOpponentId = nextPlayerId(context.state.players, stage, false);
  const publicView = oneCardDefinition.getPublicView(context) as { hands?: Record<string, { count?: unknown }> };
  const count = publicView.hands?.[nextOpponentId]?.count;
  return typeof count === "number" ? count : undefined;
}

function hasNonAttackFollowUp(stage: CardStageState, hand: string[], playedCard: string): boolean {
  const remaining = hand.filter((held) => held !== playedCard);
  return remaining.some((held) => attackValue(held) === 0 && validateCardPlay(stage, held).ok);
}

function majoritySuitCount(hand: string[]): number {
  const counts = new Map<string, number>();
  for (const card of hand) {
    const suit = cardSuit(card);
    if (suit !== "J") {
      counts.set(suit, (counts.get(suit) ?? 0) + 1);
    }
  }
  return Math.max(0, ...counts.values());
}

function attackValue(card: string): number {
  if (card === "BJ") return 5;
  if (card === "CJ") return 7;
  const rank = cardRank(card);
  const suit = cardSuit(card);
  if (rank === "2") return 2;
  if (rank === "A") return suit === "S" ? 5 : 3;
  return 0;
}

function cardRank(card: string): string {
  return card === "BJ" || card === "CJ" ? card : card.slice(0, -1);
}

function cardSuit(card: string): "S" | "H" | "C" | "D" | "J" {
  return card === "BJ" || card === "CJ" ? "J" : card.slice(-1) as "S" | "H" | "C" | "D";
}

function cardRankOrder(rank: string): number {
  return ["3", "4", "5", "6", "8", "9", "10", "Q", "J", "K", "7", "2", "A", "BJ", "CJ"].indexOf(rank);
}

function stableCardNoise(seed: string, key: string): number {
  let hash = 2166136261;
  const input = `${seed}:${key}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function readStage(value: JsonObject): CardStageState {
  return value as unknown as CardStageState;
}

function readPlayer(value: JsonObject | undefined): CardPlayerState {
  return (value ?? { hand: [] }) as unknown as CardPlayerState;
}

function isSuit(value: unknown): value is "S" | "H" | "C" | "D" {
  return value === "S" || value === "H" || value === "C" || value === "D";
}

function canChooseSuit(card: string): boolean {
  return card === "BJ" || card === "CJ" || card.slice(0, -1) === "7";
}

// Check valid move logic authoritatively
function validateCardPlay(stage: CardStageState, card: string): ValidationResult {
  const problem = cardPlayProblem(stage, card);
  return problem === null ? { ok: true } : { ok: false, code: "invalid_action", message: problem };
}

function nextPlayerId(players: PlayerSeat[], stage: CardStageState, skipNext: boolean): string {
  const currentSeat = players.findIndex((p) => p.playerId === stage.currentPlayerId);
  const N = players.length;
  if (currentSeat < 0 || N === 0) {
    return players[0]?.playerId ?? "";
  }

  const step = stage.turnDirection === "clockwise" ? 1 : -1;
  const findNextActive = (fromSeat: number) => {
    let s = fromSeat;
    for (let i = 0; i < N; i++) {
      s = (s + step + N) % N;
      const candidateId = players[s]?.playerId ?? "";
      if (!stage.eliminatedPlayerIds.includes(candidateId)) return s;
    }
    return fromSeat;
  };

  let nextSeat = findNextActive(currentSeat);
  if (skipNext) {
    nextSeat = findNextActive(nextSeat);
  }
  return players[nextSeat]?.playerId ?? "";
}

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
import { createGameEventId, defineGameDefinition } from "@bighouse/game-sdk/server";
import { baseGameMetadata } from "./metadata";

export type CardStageState = {
  discardPile: string[];
  deck: string[];
  deckCount: number;
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

// Seedable PRNG (Mulberry32) for deterministic initial shuffling
function seedRandom(seedStr: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  }
  return function () {
    h += 0xe120fc15;
    let tmp = Math.imul(h ^ (h >>> 15), 1 | h);
    tmp = (tmp + Math.imul(tmp ^ (tmp >>> 7), 61 | tmp)) ^ tmp;
    return ((tmp ^ (tmp >>> 14)) >>> 0) / 4294967296;
  };
}

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

function seededShuffle(deck: string[], seed: string): string[] {
  const rand = seedRandom(seed);
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const temp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = temp;
  }
  return shuffled;
}

export const oneCardDefinition = defineGameDefinition(gameMetadata, {
  initialStageState(context): JsonObject {
    const seed = String(context.room.config?.seed ?? (context.room.roomId + "_" + context.room.createdAt));
    let fullDeck = seededShuffle(generateDeck(), seed);

    const N = context.players.length;
    if (N === 0) {
      return {
        discardPile: [],
        deck: [],
        deckCount: 0,
        turnDirection: "clockwise",
        activeAttackCount: 0,
        eliminatedPlayerIds: [],
        hasExtraTurn: false
      } satisfies CardStageState;
    }

    // Deal 7 cards to each player seat (initial hands are sliced deterministically by seat)
    const dealtCount = N * 7;
    const initialDeck = fullDeck.slice(dealtCount);

    // Find the first open card that is NOT a Joker
    let discardPile: string[] = [];
    let deck: string[] = [];
    let openCardIndex = 0;
    for (let i = 0; i < initialDeck.length; i++) {
      const card = initialDeck[i]!;
      if (card !== "BJ" && card !== "CJ") {
        discardPile.push(card);
        openCardIndex = i;
        break;
      }
    }
    // If somehow all are Jokers (impossible with 54-card single deck), take first
    if (discardPile.length === 0) {
      discardPile.push(initialDeck[0]!);
      openCardIndex = 0;
    }
    // Reconstruct remaining deck without the open card
    deck = initialDeck.filter((_, idx) => idx !== openCardIndex);

    const firstPlayerId = context.players[0]?.playerId;
    return {
      discardPile,
      deck,
      deckCount: deck.length,
      ...(firstPlayerId ? { currentPlayerId: firstPlayerId } : {}),
      turnDirection: "clockwise",
      activeAttackCount: 0,
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    } satisfies CardStageState;
  },

  initialPlayerState(player, context): JsonObject {
    const seed = String(context.room.config?.seed ?? (context.room.roomId + "_" + context.room.createdAt));
    const fullDeck = seededShuffle(generateDeck(), seed);
    const seat = player.seat;
    const hand = fullDeck.slice(seat * 7, (seat + 1) * 7);
    return { hand } satisfies CardPlayerState;
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
            // Shuffle recycled
            const shuffled = seededShuffle(recycled, `${context.now}_${i}`);
            stage.deck = shuffled;
            stage.discardPile = [stage.discardPile[stage.discardPile.length - 1]!];
            stage.deckCount = stage.deck.length;
            events.push({
              id: createGameEventId(),
              type: "onecard.deckRecycled",
              visibility: "public",
              payload: { deckCount: stage.deckCount },
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
      stage.deckCount = stage.deck.length;

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
      if (playerState.hand.length >= 16) {
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
  const topCard = stage.discardPile[stage.discardPile.length - 1];
  if (!topCard) {
    return { ok: true }; // stage is clean, any card is valid
  }

  const isCardJoker = card === "BJ" || card === "CJ";
  const cardSuit = isCardJoker ? "J" : card.slice(-1) as "S" | "H" | "C" | "D";
  const cardRank = isCardJoker ? card : card.slice(0, -1);

  // Stacking attack active
  if (stage.activeAttackCount > 0 && stage.activeAttackCard) {
    const attackCard = stage.activeAttackCard;
    const isAttackJoker = attackCard === "BJ" || attackCard === "CJ";
    const attackRank = isAttackJoker ? attackCard : attackCard.slice(0, -1);

    // Defense matching
    if (attackRank === "2") {
      // 2 can be defended by 2, A, BJ, CJ
      if (cardRank === "2" || cardRank === "A" || isCardJoker) {
        return { ok: true };
      }
      return { ok: false, code: "invalid_action", message: "Must defend attack with a 2, A, or Joker" };
    } else if (attackRank === "A") {
      // A can be defended by A, BJ, CJ (not 2)
      if (cardRank === "A" || isCardJoker) {
        return { ok: true };
      }
      return { ok: false, code: "invalid_action", message: "Must defend Ace attack with an Ace or Joker" };
    } else if (attackCard === "BJ") {
      // BJ can only be defended by CJ
      if (card === "CJ") {
        return { ok: true };
      }
      return { ok: false, code: "invalid_action", message: "Must defend Black Joker with a Color Joker" };
    } else if (attackCard === "CJ") {
      // CJ cannot be defended!
      return { ok: false, code: "invalid_action", message: "Color Joker attack cannot be defended" };
    }
  }

  // Normal play (no active attack)
  if (isCardJoker) {
    return { ok: true }; // Jokers can always be played
  }

  const isTopJoker = topCard === "BJ" || topCard === "CJ";
  const topSuit = isTopJoker ? "J" : topCard.slice(-1) as "S" | "H" | "C" | "D";
  const topRank = isTopJoker ? topCard : topCard.slice(0, -1);

  // If top is Joker or a 7, matching goes by the declared chosen suit.
  if ((isTopJoker || topRank === "7") && stage.chosenSuit) {
    if (cardSuit === stage.chosenSuit) {
      return { ok: true };
    }
    return { ok: false, code: "invalid_action", message: `Must match the chosen suit: ${stage.chosenSuit}` };
  }

  // Standard match (same suit or same rank)
  if (cardSuit === topSuit || cardRank === topRank) {
    return { ok: true };
  }

  return { ok: false, code: "invalid_action", message: "Card must match the top card's suit or number" };
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

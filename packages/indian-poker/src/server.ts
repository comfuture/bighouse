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

// ─── Rules Summary ───────────────────────────────────────────────────────────
//
// Indian Poker (a.k.a. Blind Man's Bluff), heads-up:
//
// 1. Every player antes, then the dealer gives each player exactly one card
//    face-out. A player sees every other card but never their own.
// 2. Players alternate betting actions until the wagers are matched:
//    check / bet / call / raise / double / die (fold).
// 3. When the wagers are matched both players have agreed to open, so the
//    cards are revealed and the higher rank takes the pot. Equal ranks refund
//    each player's own contribution.
// 4. Chips live in `stageState`, so they persist across rounds inside the same
//    room. Both players must request `nextRound` before a new hand is dealt.
// 5. The match ends when a player cannot ante for another round (0 chips).
//
// Card secrecy: the dealt cards are stored in `stageState.cards` because
// `initialStageState()` runs before `initialPlayerState()` and therefore cannot
// write into `playerStates`. `getPublicView()` filters the cards out until the
// round is revealed, and `getPrivateView()` masks the requesting player's own
// card. Nothing else may read `stageState.cards`.

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Round phases inside an active room:
 * - "idle": no hand dealt yet (room is still filling up).
 * - "betting": a player must take a betting action.
 * - "reveal": the hand is resolved and revealed, waiting for `nextRound`.
 * - "gameOver": a player is out of chips, the match is done.
 */
export type BettingPhase = "idle" | "betting" | "reveal" | "gameOver";

export type RevealReason = "showdown" | "fold";

export type IndianPokerRoundResult = {
  round: number;
  reason: RevealReason;
  /** Every player's card, safe to publish because the round is over. */
  cards: Record<string, string>;
  /** Round winner, or omitted when the ranks tied. */
  winnerPlayerId?: string;
  isTie: boolean;
  /** Chips that were actually contested (after uncalled bets were refunded). */
  pot: number;
  foldedPlayerId?: string;
  /** Net chip movement for the round, keyed by playerId. */
  chipDelta: Record<string, number>;
};

export type IndianPokerStageState = {
  phase: BettingPhase;
  /** 1-based hand counter, 0 while the room is still idle. */
  round: number;
  /** Deterministic shuffle seed, kept in state so reshuffles stay reproducible. */
  seed: string;
  /** Undealt cards. Never published. */
  deck: string[];
  /** Dealt cards keyed by playerId. Never published before the reveal. */
  cards: Record<string, string>;
  /** Chip stacks, keyed by playerId. Survives every round in the same room. */
  chips: Record<string, number>;
  /** Chips committed to the current pot this round, keyed by playerId. */
  bets: Record<string, number>;
  pot: number;
  /** Highest single-player commitment this round. */
  currentBet: number;
  ante: number;
  startingChips: number;
  maxRaises: number;
  raiseCount: number;
  /** Consecutive checks in the current betting round. */
  checkCount: number;
  /** Whose betting turn it is. Cleared outside the betting phase. */
  currentPlayerId?: string;
  lastAggressorPlayerId?: string;
  /** Players who asked to play another round. */
  nextRoundRequests: string[];
  roundResult?: IndianPokerRoundResult;
  gameWinnerPlayerId?: string;
};

export type IndianPokerPlayerState = {
  seat: number;
};

export const gameMetadata = baseGameMetadata;

export const INDIAN_POKER_ACTIONS = ["bet", "check", "call", "raise", "double", "die", "nextRound"] as const;

export type IndianPokerActionType = (typeof INDIAN_POKER_ACTIONS)[number];

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_STARTING_CHIPS = 100;
const DEFAULT_ANTE = 5;
const DEFAULT_MAX_RAISES = 4;
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
const SUITS = ["S", "H", "D", "C"] as const;

// ─── Card Helpers ────────────────────────────────────────────────────────────

/** Mulberry32 seeded PRNG so shuffles are reproducible from state alone. */
function seedRandom(seed: string): () => number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  }
  return function next(): number {
    hash += 0xe120fc15;
    let tmp = Math.imul(hash ^ (hash >>> 15), 1 | hash);
    tmp = (tmp + Math.imul(tmp ^ (tmp >>> 7), 61 | tmp)) ^ tmp;
    return ((tmp ^ (tmp >>> 14)) >>> 0) / 4294967296;
  };
}

function generateDeck(): string[] {
  const deck: string[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(rank + suit);
    }
  }
  return deck;
}

function shuffledDeck(seed: string): string[] {
  const random = seedRandom(seed);
  const deck = generateDeck();
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = deck[index]!;
    deck[index] = deck[swap]!;
    deck[swap] = held;
  }
  return deck;
}

/** Rank strength with ace high. Suits never break ties. */
export function cardValue(card: string): number {
  const rank = card.slice(0, -1);
  switch (rank) {
    case "A":
      return 14;
    case "K":
      return 13;
    case "Q":
      return 12;
    case "J":
      return 11;
    default: {
      const parsed = Number.parseInt(rank, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
}

// ─── State Helpers ───────────────────────────────────────────────────────────

function readStage(value: JsonObject): IndianPokerStageState {
  return value as unknown as IndianPokerStageState;
}

function writeStage(stage: IndianPokerStageState): JsonObject {
  return stage as unknown as JsonObject;
}

function opponentOf(players: PlayerSeat[], playerId: string): PlayerSeat | undefined {
  return players.find((player) => player.playerId !== playerId);
}

function orderedPlayers(players: PlayerSeat[]): PlayerSeat[] {
  return [...players].sort((left, right) => left.seat - right.seat);
}

function chipsOf(stage: IndianPokerStageState, playerId: string): number {
  return stage.chips[playerId] ?? 0;
}

function betOf(stage: IndianPokerStageState, playerId: string): number {
  return stage.bets[playerId] ?? 0;
}

/** Chips the player still has to put in to match the highest commitment. */
export function amountToCall(stage: IndianPokerStageState, playerId: string): number {
  return Math.max(0, stage.currentBet - betOf(stage, playerId));
}

function readConfigNumber(config: JsonObject | undefined, key: string, fallback: number, minimum: number): number {
  const raw = config?.[key];
  const parsed = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.floor(parsed));
}

function event(type: string, payload: JsonObject, createdAt: number): GameEvent {
  return { id: createGameEventId(), type, visibility: "public", payload, createdAt };
}

function systemEvent(type: string, payload: JsonObject, createdAt: number): GameEvent {
  return { id: createGameEventId(), type, visibility: "system", payload, createdAt };
}

function privateEvent(type: string, playerId: string, payload: JsonObject, createdAt: number): GameEvent {
  return { id: createGameEventId(), type, visibility: "private", playerId, payload, createdAt };
}

// ─── Dealing ─────────────────────────────────────────────────────────────────

/**
 * Starts a hand: reshuffle when the deck is short, deal one card per player,
 * collect the ante, and hand the first turn to the round's opening seat.
 */
function dealRound(stage: IndianPokerStageState, players: PlayerSeat[], now: number): GameEvent[] {
  const seats = orderedPlayers(players);
  const events: GameEvent[] = [];

  stage.round += 1;
  if (stage.deck.length < seats.length) {
    stage.deck = shuffledDeck(`${stage.seed}:reshuffle:${stage.round}`);
    events.push(event("indian-poker.deckReshuffled", { round: stage.round }, now));
  }

  stage.phase = "betting";
  stage.cards = {};
  stage.bets = {};
  stage.pot = 0;
  stage.currentBet = 0;
  stage.raiseCount = 0;
  stage.checkCount = 0;
  stage.nextRoundRequests = [];
  delete stage.lastAggressorPlayerId;
  delete stage.roundResult;

  for (const player of seats) {
    stage.cards[player.playerId] = stage.deck.pop()!;
  }

  for (const player of seats) {
    // A short stack antes whatever is left, which puts them all-in for the hand.
    const ante = Math.min(stage.ante, chipsOf(stage, player.playerId));
    stage.chips[player.playerId] = chipsOf(stage, player.playerId) - ante;
    stage.bets[player.playerId] = ante;
    stage.pot += ante;
    stage.currentBet = Math.max(stage.currentBet, ante);
  }

  // Alternate who opens the betting so neither seat keeps the positional edge.
  const opener = seats[(stage.round - 1) % seats.length];
  if (opener) {
    stage.currentPlayerId = opener.playerId;
  } else {
    delete stage.currentPlayerId;
  }

  events.push(
    event(
      "indian-poker.roundStarted",
      {
        round: stage.round,
        ante: stage.ante,
        pot: stage.pot,
        bets: { ...stage.bets },
        chips: { ...stage.chips },
        currentBet: stage.currentBet,
        openingPlayerId: stage.currentPlayerId ?? null
      },
      now
    )
  );

  // Each player privately learns the card they are allowed to read.
  for (const player of seats) {
    const opponent = opponentOf(seats, player.playerId);
    if (!opponent) continue;
    events.push(
      privateEvent(
        "indian-poker.cardDealt",
        player.playerId,
        {
          round: stage.round,
          opponentPlayerId: opponent.playerId,
          opponentCard: stage.cards[opponent.playerId]!
        },
        now
      )
    );
  }

  return events;
}

// ─── Round Resolution ────────────────────────────────────────────────────────

/**
 * Refunds any wager the opponent could not cover, so an all-in short stack
 * never loses more than it risked.
 */
function refundUncalledBets(stage: IndianPokerStageState, players: PlayerSeat[]): void {
  const contested = Math.min(...players.map((player) => betOf(stage, player.playerId)));
  for (const player of players) {
    const excess = betOf(stage, player.playerId) - contested;
    if (excess <= 0) continue;
    stage.chips[player.playerId] = chipsOf(stage, player.playerId) + excess;
    stage.bets[player.playerId] = contested;
    stage.pot -= excess;
  }
}

function resolveShowdown(stage: IndianPokerStageState, players: PlayerSeat[], now: number): GameEvent[] {
  const seats = orderedPlayers(players);
  refundUncalledBets(stage, seats);

  const chipsBefore = { ...stage.chips };
  const ranked = seats
    .map((player) => ({ playerId: player.playerId, value: cardValue(stage.cards[player.playerId] ?? "") }))
    .sort((left, right) => right.value - left.value);
  const best = ranked[0];
  const isTie = ranked.length > 1 && ranked[0]!.value === ranked[1]!.value;
  const winnerPlayerId = isTie ? undefined : best?.playerId;

  if (winnerPlayerId) {
    stage.chips[winnerPlayerId] = chipsOf(stage, winnerPlayerId) + stage.pot;
  } else {
    // Equal ranks: everyone takes their own contribution back.
    for (const player of seats) {
      stage.chips[player.playerId] = chipsOf(stage, player.playerId) + betOf(stage, player.playerId);
    }
  }

  return finishRound(
    stage,
    seats,
    chipsBefore,
    { reason: "showdown", isTie, ...(winnerPlayerId ? { winnerPlayerId } : {}) },
    now
  );
}

function resolveFold(stage: IndianPokerStageState, players: PlayerSeat[], foldedPlayerId: string, now: number): GameEvent[] {
  const seats = orderedPlayers(players);
  const chipsBefore = { ...stage.chips };
  const winner = opponentOf(seats, foldedPlayerId);
  if (winner) {
    // The uncalled portion of the winner's own wager comes back inside the pot.
    stage.chips[winner.playerId] = chipsOf(stage, winner.playerId) + stage.pot;
  }

  return finishRound(
    stage,
    seats,
    chipsBefore,
    { reason: "fold", isTie: false, foldedPlayerId, ...(winner ? { winnerPlayerId: winner.playerId } : {}) },
    now
  );
}

type RoundOutcome = {
  reason: RevealReason;
  isTie: boolean;
  winnerPlayerId?: string;
  foldedPlayerId?: string;
};

/** Shared tail for both endings: publish the reveal and check for a match winner. */
function finishRound(
  stage: IndianPokerStageState,
  seats: PlayerSeat[],
  chipsBefore: Record<string, number>,
  outcome: RoundOutcome,
  now: number
): GameEvent[] {
  const events: GameEvent[] = [];
  const chipDelta: Record<string, number> = {};
  for (const player of seats) {
    chipDelta[player.playerId] = chipsOf(stage, player.playerId) - (chipsBefore[player.playerId] ?? 0);
  }

  const result: IndianPokerRoundResult = {
    round: stage.round,
    reason: outcome.reason,
    cards: { ...stage.cards },
    isTie: outcome.isTie,
    pot: stage.pot,
    chipDelta,
    ...(outcome.winnerPlayerId ? { winnerPlayerId: outcome.winnerPlayerId } : {}),
    ...(outcome.foldedPlayerId ? { foldedPlayerId: outcome.foldedPlayerId } : {})
  };

  stage.phase = "reveal";
  stage.roundResult = result;
  stage.nextRoundRequests = [];
  // The pot has been paid out into the stacks; `roundResult.pot` keeps the
  // contested amount around for the reveal panel.
  stage.pot = 0;
  delete stage.currentPlayerId;

  events.push(
    event(
      outcome.reason === "fold" ? "indian-poker.fold" : "indian-poker.showdown",
      {
        round: result.round,
        cards: result.cards,
        // Deliberately not `winnerPlayerId`: only the terminal `gameWon` event
        // carries that key, which is what RoomDO records as the match result.
        roundWinnerPlayerId: result.winnerPlayerId ?? null,
        foldedPlayerId: result.foldedPlayerId ?? null,
        isTie: result.isTie,
        pot: result.pot,
        chipDelta: result.chipDelta,
        chips: { ...stage.chips },
        bets: { ...stage.bets }
      },
      now
    )
  );

  return events;
}

/**
 * A player who cannot ante again ends the match. Called after a round resolves
 * so the standard finished-room rematch flow can take over.
 */
function applyMatchOver(stage: IndianPokerStageState, seats: PlayerSeat[], now: number): GameEvent[] {
  const broke = seats.find((player) => chipsOf(stage, player.playerId) <= 0);
  if (!broke) return [];

  const ranked = [...seats].sort((left, right) => chipsOf(stage, right.playerId) - chipsOf(stage, left.playerId));
  const winnerPlayerId = ranked[0]?.playerId;
  stage.phase = "gameOver";
  stage.nextRoundRequests = [];
  delete stage.currentPlayerId;
  if (!winnerPlayerId) return [];

  stage.gameWinnerPlayerId = winnerPlayerId;
  return [
    systemEvent(
      "indian-poker.gameWon",
      {
        winnerPlayerId,
        eliminatedPlayerId: broke.playerId,
        rounds: stage.round,
        chips: { ...stage.chips }
      },
      now
    )
  ];
}

// ─── Public Turn Derivation ──────────────────────────────────────────────────

/**
 * The player the room is waiting on. During "reveal" this points at whoever
 * still owes a `nextRound` request, which is also what RoomDO uses to schedule
 * bot turns, so a bot never stalls the round handshake.
 */
export function pendingPlayerId(stage: IndianPokerStageState, players: PlayerSeat[]): string | undefined {
  if (stage.phase === "betting") return stage.currentPlayerId;
  if (stage.phase !== "reveal") return undefined;
  return orderedPlayers(players).find((player) => !stage.nextRoundRequests.includes(player.playerId))?.playerId;
}

/** Betting actions the player is allowed to take right now. */
export function availableActions(stage: IndianPokerStageState, playerId: string): IndianPokerActionType[] {
  if (stage.phase === "reveal") {
    return stage.nextRoundRequests.includes(playerId) ? [] : ["nextRound"];
  }
  if (stage.phase !== "betting" || stage.currentPlayerId !== playerId) return [];

  const toCall = amountToCall(stage, playerId);
  const chips = chipsOf(stage, playerId);
  const actions: IndianPokerActionType[] = [];
  if (toCall === 0) {
    actions.push("check");
    if (chips > 0) actions.push("bet");
  } else {
    actions.push("call");
    if (chips > 0 && stage.raiseCount < stage.maxRaises) {
      actions.push("raise", "double");
    }
  }
  actions.push("die");
  return actions;
}

// ─── Game Definition ─────────────────────────────────────────────────────────

export const indianPokerDefinition = defineGameDefinition(gameMetadata, {
  initialStageState(context): JsonObject {
    const config = context.room.config;
    const startingChips = readConfigNumber(config, "startingChips", DEFAULT_STARTING_CHIPS, 2);
    const ante = Math.min(
      readConfigNumber(config, "ante", DEFAULT_ANTE, 1),
      Math.max(1, Math.floor(startingChips / 2))
    );
    // `now` is folded into the seed so a rematch in the same room does not
    // replay the exact same deck.
    const seed = `${String(config?.seed ?? context.room.roomId)}:${context.now}`;

    const stage: IndianPokerStageState = {
      phase: "idle",
      round: 0,
      seed,
      deck: shuffledDeck(seed),
      cards: {},
      chips: Object.fromEntries(context.players.map((player) => [player.playerId, startingChips])),
      bets: {},
      pot: 0,
      currentBet: 0,
      ante,
      startingChips,
      maxRaises: readConfigNumber(config, "maxRaises", DEFAULT_MAX_RAISES, 1),
      raiseCount: 0,
      checkCount: 0,
      nextRoundRequests: []
    };

    // RoomDO also calls this while the room is still empty, so only deal once
    // there are enough seats for a real hand.
    if (context.players.length >= gameMetadata.minPlayers) {
      dealRound(stage, context.players, context.now);
    }

    return writeStage(stage);
  },

  initialPlayerState(player): JsonObject {
    // Cards cannot live here: RoomDO builds `stageState` (where the deal
    // happens) before it builds `playerStates`.
    return { seat: player.seat } satisfies IndianPokerPlayerState;
  },

  validateAction(context: GameContext, action: ClientGameAction): ValidationResult {
    const stage = readStage(context.state.stageState);

    if (!(INDIAN_POKER_ACTIONS as readonly string[]).includes(action.type)) {
      return { ok: false, code: "invalid_action", message: `Unsupported Indian Poker action '${action.type}'` };
    }
    if (stage.phase === "gameOver" || stage.gameWinnerPlayerId) {
      return { ok: false, code: "invalid_action", message: "The match is already over" };
    }

    if (action.type === "nextRound") {
      if (stage.phase !== "reveal") {
        return { ok: false, code: "invalid_action", message: "The round is still in progress" };
      }
      if (stage.nextRoundRequests.includes(action.playerId)) {
        return { ok: false, code: "invalid_action", message: "Another round was already requested" };
      }
      return { ok: true };
    }

    if (stage.phase !== "betting") {
      return { ok: false, code: "invalid_action", message: "Betting is closed" };
    }
    if (action.playerId !== stage.currentPlayerId) {
      return { ok: false, code: "invalid_turn", message: "It is not this player's turn" };
    }
    if (!opponentOf(context.state.players, action.playerId)) {
      return { ok: false, code: "invalid_action", message: "Indian Poker needs an opponent" };
    }

    const chips = chipsOf(stage, action.playerId);
    const toCall = amountToCall(stage, action.playerId);

    switch (action.type as IndianPokerActionType) {
      case "die":
        return { ok: true };

      case "check":
        return toCall === 0
          ? { ok: true }
          : { ok: false, code: "invalid_action", message: "There is a bet to answer, so check is not available" };

      case "call":
        return toCall > 0
          ? { ok: true }
          : { ok: false, code: "invalid_action", message: "Nothing to call, check instead" };

      case "bet": {
        if (toCall > 0) {
          return { ok: false, code: "invalid_action", message: "There is already a bet, raise or call instead" };
        }
        const amount = readAmount(action.payload);
        if (amount === undefined) {
          return { ok: false, code: "invalid_action", message: "Bet amount must be a positive whole number" };
        }
        if (amount > chips) {
          return { ok: false, code: "invalid_action", message: "Not enough chips for that bet" };
        }
        return { ok: true };
      }

      case "raise": {
        if (toCall === 0) {
          return { ok: false, code: "invalid_action", message: "Nothing to raise, bet instead" };
        }
        if (stage.raiseCount >= stage.maxRaises) {
          return { ok: false, code: "invalid_action", message: "The raise cap for this round was reached" };
        }
        const amount = readAmount(action.payload);
        if (amount === undefined) {
          return { ok: false, code: "invalid_action", message: "Raise amount must be a positive whole number" };
        }
        if (chips <= toCall) {
          return { ok: false, code: "invalid_action", message: "Not enough chips to raise, call or die instead" };
        }
        return { ok: true };
      }

      case "double": {
        if (toCall === 0) {
          return { ok: false, code: "invalid_action", message: "Nothing to double, bet instead" };
        }
        if (stage.raiseCount >= stage.maxRaises) {
          return { ok: false, code: "invalid_action", message: "The raise cap for this round was reached" };
        }
        if (chips <= toCall) {
          return { ok: false, code: "invalid_action", message: "Not enough chips to double, call or die instead" };
        }
        return { ok: true };
      }

      default:
        return { ok: false, code: "invalid_action", message: `Unsupported Indian Poker action '${action.type}'` };
    }
  },

  applyAction(context: GameContext, action: ClientGameAction): ActionResult {
    const state = context.state;
    const stage = readStage(state.stageState);
    const seats = orderedPlayers(state.players);
    const events: GameEvent[] = [];

    if (action.type === "nextRound") {
      stage.nextRoundRequests = [...stage.nextRoundRequests, action.playerId];
      const waiting = seats.filter((player) => !stage.nextRoundRequests.includes(player.playerId));
      events.push(
        event(
          "indian-poker.nextRoundRequested",
          {
            playerId: action.playerId,
            requests: [...stage.nextRoundRequests],
            waitingPlayerIds: waiting.map((player) => player.playerId)
          },
          context.now
        )
      );
      if (waiting.length === 0) {
        events.push(...dealRound(stage, seats, context.now));
      }
      state.stageState = writeStage(stage);
      return { state, events };
    }

    const opponent = opponentOf(seats, action.playerId)!;
    const toCall = amountToCall(stage, action.playerId);

    switch (action.type as IndianPokerActionType) {
      case "check": {
        stage.checkCount += 1;
        events.push(event("indian-poker.check", { playerId: action.playerId, pot: stage.pot }, context.now));
        if (stage.checkCount >= seats.length) {
          // Everyone passed, so the wagers are matched and the hand opens.
          events.push(...resolveShowdown(stage, seats, context.now));
        } else {
          stage.currentPlayerId = opponent.playerId;
        }
        break;
      }

      case "bet": {
        const amount = Math.min(readAmount(action.payload) ?? 0, chipsOf(stage, action.playerId));
        commit(stage, action.playerId, amount);
        stage.raiseCount += 1;
        stage.checkCount = 0;
        stage.lastAggressorPlayerId = action.playerId;
        stage.currentPlayerId = opponent.playerId;
        events.push(
          event(
            "indian-poker.bet",
            {
              playerId: action.playerId,
              amount,
              pot: stage.pot,
              currentBet: stage.currentBet,
              chips: { ...stage.chips }
            },
            context.now
          )
        );
        break;
      }

      case "raise":
      case "double": {
        // `double` is the one-tap version of "match the bet, then raise by the
        // same amount", so the opponent has to answer twice their own wager.
        const requested = action.type === "double" ? toCall : (readAmount(action.payload) ?? 0);
        const commitment = Math.min(toCall + requested, chipsOf(stage, action.playerId));
        const raisedBy = commitment - toCall;
        commit(stage, action.playerId, commitment);
        stage.raiseCount += 1;
        stage.checkCount = 0;
        stage.lastAggressorPlayerId = action.playerId;
        stage.currentPlayerId = opponent.playerId;
        events.push(
          event(
            `indian-poker.${action.type}`,
            {
              playerId: action.playerId,
              called: toCall,
              raisedBy,
              amount: commitment,
              pot: stage.pot,
              currentBet: stage.currentBet,
              chips: { ...stage.chips }
            },
            context.now
          )
        );
        break;
      }

      case "call": {
        const amount = Math.min(toCall, chipsOf(stage, action.playerId));
        commit(stage, action.playerId, amount);
        events.push(
          event(
            "indian-poker.call",
            { playerId: action.playerId, amount, pot: stage.pot, chips: { ...stage.chips } },
            context.now
          )
        );
        // Calling matches the wagers, which is the agreement to open.
        events.push(...resolveShowdown(stage, seats, context.now));
        break;
      }

      case "die": {
        events.push(
          event("indian-poker.die", { playerId: action.playerId, pot: stage.pot }, context.now)
        );
        events.push(...resolveFold(stage, seats, action.playerId, context.now));
        break;
      }
    }

    if (stage.phase === "reveal") {
      const matchOverEvents = applyMatchOver(stage, seats, context.now);
      if (matchOverEvents.length > 0) {
        events.push(...matchOverEvents);
        state.phase = "finished";
      }
    }

    state.stageState = writeStage(stage);
    return { state, events };
  },

  getPublicView(context: GameContext): JsonObject {
    const stage = readStage(context.state.stageState);
    const seats = orderedPlayers(context.state.players);
    const revealed = stage.phase === "reveal" || stage.phase === "gameOver";
    const turnPlayerId = pendingPlayerId(stage, seats);

    return {
      phase: stage.phase,
      round: stage.round,
      pot: stage.pot,
      ante: stage.ante,
      startingChips: stage.startingChips,
      currentBet: stage.currentBet,
      chips: { ...stage.chips },
      bets: { ...stage.bets },
      toCall: Object.fromEntries(seats.map((player) => [player.playerId, amountToCall(stage, player.playerId)])),
      currentPlayerId: turnPlayerId,
      lastAggressorPlayerId: stage.lastAggressorPlayerId,
      raiseCount: stage.raiseCount,
      maxRaises: stage.maxRaises,
      availableActions: turnPlayerId ? availableActions(stage, turnPlayerId) : [],
      nextRoundRequests: [...stage.nextRoundRequests],
      deckCount: stage.deck.length,
      revealed,
      // Cards stay out of the public view until the round is over.
      ...(revealed && stage.roundResult ? { roundResult: stage.roundResult, cards: { ...stage.cards } } : {}),
      ...(stage.gameWinnerPlayerId ? { winnerPlayerId: stage.gameWinnerPlayerId } : {})
    };
  },

  getPrivateView(context: GameContext, playerId: string): JsonObject {
    const stage = readStage(context.state.stageState);
    const opponent = opponentOf(context.state.players, playerId);
    const revealed = stage.phase === "reveal" || stage.phase === "gameOver";
    const ownCard = stage.cards[playerId];

    return {
      seat: context.state.players.find((player) => player.playerId === playerId)?.seat ?? 0,
      // The whole point of the game: you read the other forehead, not your own.
      opponentPlayerId: opponent?.playerId,
      opponentCard: opponent ? (stage.cards[opponent.playerId] ?? null) : null,
      myCard: revealed ? (ownCard ?? null) : ownCard ? "hidden" : null,
      myCardRevealed: revealed && Boolean(ownCard),
      availableActions: availableActions(stage, playerId)
    };
  },

  nextTimers() {
    return [];
  },

  selectBotAction(context: BotGameContext): GameAction | null {
    return selectIndianPokerBotAction(context);
  }
});

/** Moves chips from a stack into the pot and tracks the new high wager. */
function commit(stage: IndianPokerStageState, playerId: string, amount: number): void {
  const paid = Math.max(0, Math.min(amount, chipsOf(stage, playerId)));
  stage.chips[playerId] = chipsOf(stage, playerId) - paid;
  stage.bets[playerId] = betOf(stage, playerId) + paid;
  stage.pot += paid;
  stage.currentBet = Math.max(stage.currentBet, betOf(stage, playerId));
}

function readAmount(payload: JsonObject): number | undefined {
  const raw = payload.amount;
  const amount = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(amount)) return undefined;
  const whole = Math.floor(amount);
  return whole > 0 ? whole : undefined;
}

// ─── Bot AI ──────────────────────────────────────────────────────────────────

/**
 * The bot reads the opponent's forehead exactly like a human does: it never
 * looks at its own card. A low opposing card means the bot is probably ahead.
 */
function selectIndianPokerBotAction(context: BotGameContext): GameAction | null {
  const stage = readStage(context.state.stageState);
  const me = context.player.playerId;
  if (context.state.phase !== "active" || stage.gameWinnerPlayerId) return null;

  if (stage.phase === "reveal") {
    return stage.nextRoundRequests.includes(me) ? null : { type: "nextRound", payload: {} };
  }
  if (stage.phase !== "betting" || stage.currentPlayerId !== me) return null;

  const opponent = opponentOf(context.state.players, me);
  if (!opponent) return null;

  const opponentValue = cardValue(stage.cards[opponent.playerId] ?? "");
  const chips = chipsOf(stage, me);
  const toCall = amountToCall(stage, me);
  // Rough win probability: how many of the other 51 ranks beat what we see.
  const edge = (opponentValue - 8) / 6; // -1 (we are ahead) .. +1 (we are behind)
  const aggression = context.difficulty === "high" ? 0.75 : context.difficulty === "medium" ? 0.5 : 0.28;
  // Deterministic jitter keeps the bot readable in tests but not robotic.
  const jitter = ((context.state.version * 37 + stage.round * 17 + opponentValue * 11) % 100) / 100;
  const confidence = aggression - edge + (jitter - 0.5) * 0.4;

  if (toCall > 0) {
    if (confidence < -0.15 && toCall > stage.ante) {
      return { type: "die", payload: {} };
    }
    if (confidence > 0.85 && chips > toCall && stage.raiseCount < stage.maxRaises) {
      return { type: "double", payload: {} };
    }
    return { type: "call", payload: {} };
  }

  if (confidence > 0.45 && chips > 0) {
    const sizing = Math.max(1, Math.min(chips, Math.round(Math.max(stage.pot, stage.ante) * (0.5 + confidence))));
    return { type: "bet", payload: { amount: sizing } };
  }
  return { type: "check", payload: {} };
}

// ─── Plugin Export ───────────────────────────────────────────────────────────

export const indianPokerGamePlugin = {
  gameMetadata,
  gameDefinition: indianPokerDefinition
} satisfies ServerGamePlugin;

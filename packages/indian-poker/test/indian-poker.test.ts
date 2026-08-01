import { describe, expect, it } from "vitest";
import { cloneState, type ClientGameAction, type GameEvent, type RoomState } from "@bighouse/game-sdk/server";
import {
  amountToCall,
  availableActions,
  cardValue,
  indianPokerDefinition,
  pendingPlayerId,
  type IndianPokerStageState
} from "../src/server";

const NOW = 1;

function baseState(): RoomState {
  return {
    room: {
      roomId: "room_test",
      gameId: "indian-poker",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2,
      config: { seed: "test-seed-123" },
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
}

function initState(): RoomState {
  const state = baseState();
  state.stageState = indianPokerDefinition.initialStageState({
    room: state.room,
    players: state.players,
    now: NOW
  });
  for (const player of state.players) {
    state.playerStates[player.playerId] = indianPokerDefinition.initialPlayerState(player, {
      room: state.room,
      now: NOW
    });
  }
  return state;
}

function stageOf(state: RoomState): IndianPokerStageState {
  return state.stageState as unknown as IndianPokerStageState;
}

/** Force a known board so winner assertions do not depend on the shuffle. */
function setCards(state: RoomState, cards: Record<string, string>): void {
  const stage = stageOf(state);
  stage.cards = { ...cards };
}

function act(
  state: RoomState,
  playerId: string,
  type: string,
  payload: Record<string, unknown> = {},
  now = NOW
): { state: RoomState; events: GameEvent[] } {
  const action: ClientGameAction = {
    playerId,
    clientActionId: `${type}_${playerId}_${now}`,
    expectedVersion: state.version,
    type,
    payload
  };
  const validation = indianPokerDefinition.validateAction({ state: cloneState(state), now }, action);
  if (!validation.ok) {
    throw new Error(`unexpected rejection of ${type} by ${playerId}: ${validation.message}`);
  }
  const applied = indianPokerDefinition.applyAction({ state: cloneState(state), now }, action);
  applied.state.version += 1;
  return applied;
}

function validate(state: RoomState, playerId: string, type: string, payload: Record<string, unknown> = {}) {
  return indianPokerDefinition.validateAction(
    { state: cloneState(state), now: NOW },
    { playerId, clientActionId: "a1", expectedVersion: state.version, type, payload }
  );
}

function totalChips(state: RoomState): number {
  const stage = stageOf(state);
  return Object.values(stage.chips).reduce((sum, chips) => sum + chips, 0) + stage.pot;
}

describe("indian-poker card ranking", () => {
  it("orders ranks with ace high", () => {
    expect(cardValue("2H")).toBe(2);
    expect(cardValue("10D")).toBe(10);
    expect(cardValue("JS")).toBe(11);
    expect(cardValue("QC")).toBe(12);
    expect(cardValue("KH")).toBe(13);
    expect(cardValue("AS")).toBe(14);
  });
});

describe("indian-poker initial state", () => {
  it("stays idle until the room has enough players", () => {
    const state = baseState();
    state.stageState = indianPokerDefinition.initialStageState({ room: state.room, players: [], now: NOW });
    const stage = stageOf(state);

    expect(stage.phase).toBe("idle");
    expect(stage.round).toBe(0);
    expect(stage.cards).toEqual({});
    expect(stage.currentPlayerId).toBeUndefined();
    expect(stage.deck).toHaveLength(52);
  });

  it("antes both players and deals one card each", () => {
    const stage = stageOf(initState());

    expect(stage.phase).toBe("betting");
    expect(stage.round).toBe(1);
    expect(stage.chips).toEqual({ p1: 95, p2: 95 });
    expect(stage.bets).toEqual({ p1: 5, p2: 5 });
    expect(stage.pot).toBe(10);
    expect(stage.currentBet).toBe(5);
    expect(stage.ante).toBe(5);
    expect(stage.startingChips).toBe(100);
    expect(Object.keys(stage.cards)).toEqual(["p1", "p2"]);
    expect(stage.deck).toHaveLength(50);
    // The ante is matched, so nobody owes anything yet.
    expect(amountToCall(stage, "p1")).toBe(0);
    expect(amountToCall(stage, "p2")).toBe(0);
    expect(stage.currentPlayerId).toBe("p1");
  });

  it("gives each player a distinct card", () => {
    const stage = stageOf(initState());
    expect(stage.cards.p1).not.toBe(stage.cards.p2);
  });

  it("honours room config overrides", () => {
    const state = baseState();
    state.room.config = { seed: "cfg", startingChips: 40, ante: 2, maxRaises: 1 };
    state.stageState = indianPokerDefinition.initialStageState({
      room: state.room,
      players: state.players,
      now: NOW
    });
    const stage = stageOf(state);

    expect(stage.startingChips).toBe(40);
    expect(stage.ante).toBe(2);
    expect(stage.maxRaises).toBe(1);
    expect(stage.chips).toEqual({ p1: 38, p2: 38 });
  });

  it("stores seat information in player state", () => {
    const state = initState();
    expect(state.playerStates.p1).toEqual({ seat: 0 });
    expect(state.playerStates.p2).toEqual({ seat: 1 });
  });

  it("emits a public round start and one private card reveal per player", () => {
    const state = baseState();
    const events: GameEvent[] = [];
    // initialStageState does not return events, so replay the deal through a round.
    state.stageState = indianPokerDefinition.initialStageState({
      room: state.room,
      players: state.players,
      now: NOW
    });
    setCards(state, { p1: "2H", p2: "AS" });
    const folded = act(state, "p1", "die");
    const afterFirst = act(folded.state, "p1", "nextRound");
    events.push(...act(afterFirst.state, "p2", "nextRound").events);

    const roundStarted = events.find((candidate) => candidate.type === "indian-poker.roundStarted");
    expect(roundStarted?.visibility).toBe("public");

    const deals = events.filter((candidate) => candidate.type === "indian-poker.cardDealt");
    expect(deals).toHaveLength(2);
    for (const deal of deals) {
      expect(deal.visibility).toBe("private");
      // A private event without a target cannot be delivered.
      expect(deal.playerId).toBeTruthy();
      expect(deal.payload.opponentPlayerId).not.toBe(deal.playerId);
    }
    // Nobody is told their own card.
    const p1Deal = deals.find((candidate) => candidate.playerId === "p1");
    expect(p1Deal?.payload.opponentPlayerId).toBe("p2");
  });
});

describe("indian-poker views", () => {
  it("keeps both cards out of the public view while betting", () => {
    const state = initState();
    const stage = stageOf(state);
    const publicView = indianPokerDefinition.getPublicView({ state, now: NOW });
    const serialized = JSON.stringify(publicView);

    expect(publicView.cards).toBeUndefined();
    expect(publicView.roundResult).toBeUndefined();
    expect(publicView.revealed).toBe(false);
    expect(serialized).not.toContain(stage.cards.p1);
    expect(serialized).not.toContain(stage.cards.p2);
    // The undealt deck stays server-side; only its size is published.
    expect(publicView.deck).toBeUndefined();
    expect(publicView.seed).toBeUndefined();
    expect(publicView.deckCount).toBe(50);
  });

  it("publishes the table state the client needs", () => {
    const state = initState();
    const publicView = indianPokerDefinition.getPublicView({ state, now: NOW });

    expect(publicView).toMatchObject({
      phase: "betting",
      round: 1,
      pot: 10,
      ante: 5,
      currentBet: 5,
      chips: { p1: 95, p2: 95 },
      bets: { p1: 5, p2: 5 },
      toCall: { p1: 0, p2: 0 },
      currentPlayerId: "p1",
      deckCount: 50,
      nextRoundRequests: []
    });
    expect(publicView.availableActions).toEqual(["check", "bet", "die"]);
  });

  it("shows the opponent card but masks the player's own card", () => {
    const state = initState();
    const stage = stageOf(state);

    const p1View = indianPokerDefinition.getPrivateView({ state, now: NOW }, "p1");
    const p2View = indianPokerDefinition.getPrivateView({ state, now: NOW }, "p2");

    expect(p1View.opponentPlayerId).toBe("p2");
    expect(p1View.opponentCard).toBe(stage.cards.p2);
    expect(p1View.myCard).toBe("hidden");
    expect(p1View.myCardRevealed).toBe(false);
    expect(JSON.stringify(p1View)).not.toContain(stage.cards.p1);

    expect(p2View.opponentCard).toBe(stage.cards.p1);
    expect(p2View.myCard).toBe("hidden");
    expect(JSON.stringify(p2View)).not.toContain(stage.cards.p2);
  });

  it("reveals every card once the round is over", () => {
    const state = initState();
    setCards(state, { p1: "KD", p2: "3C" });
    const revealed = act(state, "p1", "die").state;

    const publicView = indianPokerDefinition.getPublicView({ state: revealed, now: NOW });
    expect(publicView.revealed).toBe(true);
    expect(publicView.cards).toEqual({ p1: "KD", p2: "3C" });

    const p1View = indianPokerDefinition.getPrivateView({ state: revealed, now: NOW }, "p1");
    expect(p1View.myCard).toBe("KD");
    expect(p1View.myCardRevealed).toBe(true);
  });
});

describe("indian-poker validateAction", () => {
  it("rejects unsupported action types", () => {
    expect(validate(initState(), "p1", "teleport")).toMatchObject({ ok: false, code: "invalid_action" });
  });

  it("rejects a player acting out of turn", () => {
    expect(validate(initState(), "p2", "bet", { amount: 10 })).toMatchObject({ ok: false, code: "invalid_turn" });
  });

  it("accepts the opening options for the player on turn", () => {
    const state = initState();
    expect(validate(state, "p1", "bet", { amount: 10 })).toEqual({ ok: true });
    expect(validate(state, "p1", "check")).toEqual({ ok: true });
    expect(validate(state, "p1", "die")).toEqual({ ok: true });
  });

  it("rejects malformed and oversized bet amounts", () => {
    const state = initState();
    expect(validate(state, "p1", "bet", {})).toMatchObject({ ok: false, code: "invalid_action" });
    expect(validate(state, "p1", "bet", { amount: 0 })).toMatchObject({ ok: false, code: "invalid_action" });
    expect(validate(state, "p1", "bet", { amount: -5 })).toMatchObject({ ok: false, code: "invalid_action" });
    expect(validate(state, "p1", "bet", { amount: "10" })).toMatchObject({ ok: false, code: "invalid_action" });
    expect(validate(state, "p1", "bet", { amount: 200 })).toMatchObject({ ok: false, code: "invalid_action" });
  });

  it("rejects call and raise while the wagers are level", () => {
    const state = initState();
    expect(validate(state, "p1", "call")).toMatchObject({ ok: false, code: "invalid_action" });
    expect(validate(state, "p1", "raise", { amount: 5 })).toMatchObject({ ok: false, code: "invalid_action" });
    expect(validate(state, "p1", "double")).toMatchObject({ ok: false, code: "invalid_action" });
  });

  it("rejects check once there is a wager to answer", () => {
    const afterBet = act(initState(), "p1", "bet", { amount: 10 }).state;
    expect(validate(afterBet, "p2", "check")).toMatchObject({ ok: false, code: "invalid_action" });
    expect(validate(afterBet, "p2", "call")).toEqual({ ok: true });
    expect(validate(afterBet, "p2", "double")).toEqual({ ok: true });
  });

  it("rejects raises beyond the round cap", () => {
    const state = initState();
    const stage = stageOf(state);
    stage.raiseCount = stage.maxRaises;
    stage.currentBet = 20;
    stage.bets = { p1: 5, p2: 20 };

    expect(validate(state, "p1", "raise", { amount: 5 })).toMatchObject({ ok: false, code: "invalid_action" });
    expect(validate(state, "p1", "double")).toMatchObject({ ok: false, code: "invalid_action" });
    expect(validate(state, "p1", "call")).toEqual({ ok: true });
    expect(validate(state, "p1", "die")).toEqual({ ok: true });
  });

  it("rejects a raise the player cannot cover", () => {
    const state = initState();
    const stage = stageOf(state);
    stage.currentBet = 100;
    stage.bets = { p1: 5, p2: 100 };
    stage.chips.p1 = 40;

    expect(validate(state, "p1", "raise", { amount: 5 })).toMatchObject({ ok: false, code: "invalid_action" });
    // An underfunded call is still allowed, it simply puts the player all-in.
    expect(validate(state, "p1", "call")).toEqual({ ok: true });
  });

  it("rejects nextRound while betting and repeat requests after the reveal", () => {
    const state = initState();
    expect(validate(state, "p1", "nextRound")).toMatchObject({ ok: false, code: "invalid_action" });

    const revealed = act(state, "p1", "die").state;
    expect(validate(revealed, "p1", "nextRound")).toEqual({ ok: true });

    const requested = act(revealed, "p1", "nextRound").state;
    expect(validate(requested, "p1", "nextRound")).toMatchObject({ ok: false, code: "invalid_action" });
    expect(validate(requested, "p2", "nextRound")).toEqual({ ok: true });
  });

  it("rejects betting actions after the reveal and after the match ends", () => {
    const state = initState();
    const revealed = act(state, "p1", "die").state;
    expect(validate(revealed, "p1", "bet", { amount: 5 })).toMatchObject({ ok: false, code: "invalid_action" });

    const stage = stageOf(revealed);
    stage.phase = "gameOver";
    stage.gameWinnerPlayerId = "p2";
    expect(validate(revealed, "p1", "nextRound")).toMatchObject({ ok: false, code: "invalid_action" });
  });

  it("does not mutate the state it validates", () => {
    const state = initState();
    const snapshot = JSON.stringify(state.stageState);
    validate(state, "p1", "bet", { amount: 25 });
    expect(JSON.stringify(state.stageState)).toBe(snapshot);
  });
});

describe("indian-poker betting", () => {
  it("moves chips into the pot on a bet and passes the turn", () => {
    const applied = act(initState(), "p1", "bet", { amount: 10 });
    const stage = stageOf(applied.state);

    expect(stage.chips).toEqual({ p1: 85, p2: 95 });
    expect(stage.bets).toEqual({ p1: 15, p2: 5 });
    expect(stage.pot).toBe(20);
    expect(stage.currentBet).toBe(15);
    expect(stage.currentPlayerId).toBe("p2");
    expect(amountToCall(stage, "p2")).toBe(10);
    expect(applied.events[0]).toMatchObject({ type: "indian-poker.bet", visibility: "public" });
  });

  it("treats double as call plus an equal raise", () => {
    const afterBet = act(initState(), "p1", "bet", { amount: 10 }).state;
    const applied = act(afterBet, "p2", "double");
    const stage = stageOf(applied.state);

    expect(stage.chips).toEqual({ p1: 85, p2: 75 });
    expect(stage.bets).toEqual({ p1: 15, p2: 25 });
    expect(stage.pot).toBe(40);
    expect(stage.currentPlayerId).toBe("p1");
    // The opener now owes twice what they wagered.
    expect(amountToCall(stage, "p1")).toBe(10);
    expect(applied.events[0]).toMatchObject({
      type: "indian-poker.double",
      visibility: "public",
      payload: { called: 10, raisedBy: 10, amount: 20 }
    });
  });

  it("caps an explicit raise at the player's stack", () => {
    const afterBet = act(initState(), "p1", "bet", { amount: 10 }).state;
    const applied = act(afterBet, "p2", "raise", { amount: 500 });
    const stage = stageOf(applied.state);

    expect(stage.chips.p2).toBe(0);
    expect(stage.bets.p2).toBe(100);
    expect(stage.currentBet).toBe(100);
  });

  it("resolves the pot to the higher card when a bet is called", () => {
    const state = initState();
    setCards(state, { p1: "9H", p2: "QS" });
    const afterBet = act(state, "p1", "bet", { amount: 10 }).state;
    const applied = act(afterBet, "p2", "call");
    const stage = stageOf(applied.state);

    expect(stage.phase).toBe("reveal");
    expect(stage.roundResult).toMatchObject({
      round: 1,
      reason: "showdown",
      isTie: false,
      winnerPlayerId: "p2",
      pot: 30,
      cards: { p1: "9H", p2: "QS" }
    });
    expect(stage.chips).toEqual({ p1: 85, p2: 115 });
    expect(stage.roundResult?.chipDelta).toEqual({ p1: 0, p2: 30 });

    const showdown = applied.events.find((candidate) => candidate.type === "indian-poker.showdown");
    expect(showdown?.visibility).toBe("public");
    // Only the terminal match event may carry `winnerPlayerId`, which is the key
    // RoomDO records as the match result.
    expect(showdown?.payload.winnerPlayerId).toBeUndefined();
    expect(showdown?.payload.roundWinnerPlayerId).toBe("p2");
  });

  it("opens the cards when both players check", () => {
    const state = initState();
    setCards(state, { p1: "AD", p2: "5C" });

    const afterFirstCheck = act(state, "p1", "check");
    const midStage = stageOf(afterFirstCheck.state);
    expect(midStage.phase).toBe("betting");
    expect(midStage.currentPlayerId).toBe("p2");
    expect(midStage.checkCount).toBe(1);

    const applied = act(afterFirstCheck.state, "p2", "check");
    const stage = stageOf(applied.state);
    expect(stage.phase).toBe("reveal");
    expect(stage.roundResult?.winnerPlayerId).toBe("p1");
    expect(stage.chips).toEqual({ p1: 105, p2: 95 });
  });

  it("lets a check be followed by a bet instead of an early reveal", () => {
    const afterCheck = act(initState(), "p1", "check").state;
    const afterBet = act(afterCheck, "p2", "bet", { amount: 20 });
    const stage = stageOf(afterBet.state);

    expect(stage.phase).toBe("betting");
    expect(stage.checkCount).toBe(0);
    expect(stage.currentPlayerId).toBe("p1");
    expect(amountToCall(stage, "p1")).toBe(20);
  });

  it("refunds each player's own wager when the ranks tie", () => {
    const state = initState();
    setCards(state, { p1: "7H", p2: "7S" });
    const afterBet = act(state, "p1", "bet", { amount: 20 }).state;
    const applied = act(afterBet, "p2", "call");
    const stage = stageOf(applied.state);

    expect(stage.roundResult).toMatchObject({ isTie: true, pot: 50 });
    expect(stage.roundResult?.winnerPlayerId).toBeUndefined();
    expect(stage.chips).toEqual({ p1: 100, p2: 100 });
  });

  it("gives the whole pot to the survivor when the other player dies", () => {
    const state = initState();
    setCards(state, { p1: "AS", p2: "2H" });
    const applied = act(state, "p1", "die");
    const stage = stageOf(applied.state);

    expect(stage.phase).toBe("reveal");
    expect(stage.roundResult).toMatchObject({
      reason: "fold",
      foldedPlayerId: "p1",
      winnerPlayerId: "p2",
      pot: 10
    });
    // Dying with the better card is the whole point of the bluff, so the cards
    // are still shown.
    expect(stage.roundResult?.cards).toEqual({ p1: "AS", p2: "2H" });
    expect(stage.chips).toEqual({ p1: 95, p2: 105 });
    expect(applied.events.map((candidate) => candidate.type)).toEqual([
      "indian-poker.die",
      "indian-poker.fold"
    ]);
  });

  it("refunds the part of a wager the short stack could not cover", () => {
    const state = initState();
    setCards(state, { p1: "KH", p2: "4D" });
    const stage = stageOf(state);
    stage.chips.p2 = 3;
    const contested = totalChips(state);

    const afterBet = act(state, "p1", "bet", { amount: 50 }).state;
    const applied = act(afterBet, "p2", "call");
    const finalStage = stageOf(applied.state);

    // p2 could only match 3 of the 50, so p1 gets the uncalled 47 back.
    expect(finalStage.roundResult?.pot).toBe(16);
    expect(finalStage.chips).toEqual({ p1: 108, p2: 0 });
    expect(finalStage.pot).toBe(0);
    expect(totalChips(applied.state)).toBe(contested);
  });
});

describe("indian-poker rounds", () => {
  it("waits for both players before dealing again", () => {
    const revealed = act(initState(), "p1", "die").state;

    const firstRequest = act(revealed, "p1", "nextRound");
    const midStage = stageOf(firstRequest.state);
    expect(midStage.phase).toBe("reveal");
    expect(midStage.round).toBe(1);
    expect(midStage.nextRoundRequests).toEqual(["p1"]);
    expect(firstRequest.events[0]).toMatchObject({
      type: "indian-poker.nextRoundRequested",
      visibility: "public",
      payload: { playerId: "p1", waitingPlayerIds: ["p2"] }
    });

    const secondRequest = act(firstRequest.state, "p2", "nextRound");
    const stage = stageOf(secondRequest.state);
    expect(stage.phase).toBe("betting");
    expect(stage.round).toBe(2);
    expect(secondRequest.events.some((candidate) => candidate.type === "indian-poker.roundStarted")).toBe(true);
  });

  it("carries chip stacks into the next round instead of resetting them", () => {
    const revealed = act(initState(), "p1", "die").state;
    expect(stageOf(revealed).chips).toEqual({ p1: 95, p2: 105 });

    const requested = act(revealed, "p1", "nextRound").state;
    const nextRound = act(requested, "p2", "nextRound").state;
    const stage = stageOf(nextRound);

    // Round 2 keeps the round 1 stacks and only removes the new ante.
    expect(stage.round).toBe(2);
    expect(stage.chips).toEqual({ p1: 90, p2: 100 });
    expect(stage.pot).toBe(10);
    expect(stage.roundResult).toBeUndefined();
    expect(totalChips(nextRound)).toBe(200);
  });

  it("alternates who opens the betting each round", () => {
    expect(stageOf(initState()).currentPlayerId).toBe("p1");

    const revealed = act(initState(), "p1", "die").state;
    const requested = act(revealed, "p1", "nextRound").state;
    const nextRound = act(requested, "p2", "nextRound").state;
    expect(stageOf(nextRound).currentPlayerId).toBe("p2");
  });

  it("reshuffles once the deck runs short", () => {
    const state = initState();
    const stage = stageOf(state);
    stage.deck = ["2H"];

    const revealed = act(state, "p1", "die").state;
    const requested = act(revealed, "p1", "nextRound").state;
    const nextRound = act(requested, "p2", "nextRound");

    expect(nextRound.events.some((candidate) => candidate.type === "indian-poker.deckReshuffled")).toBe(true);
    expect(stageOf(nextRound.state).deck).toHaveLength(50);
  });
});

describe("indian-poker match end", () => {
  it("finishes the room when a player can no longer ante", () => {
    const state = initState();
    setCards(state, { p1: "2H", p2: "AS" });
    stageOf(state).chips.p1 = 0;

    const afterCheck = act(state, "p1", "check").state;
    const applied = act(afterCheck, "p2", "check");
    const stage = stageOf(applied.state);

    expect(stage.phase).toBe("gameOver");
    expect(stage.gameWinnerPlayerId).toBe("p2");
    expect(stage.chips).toEqual({ p1: 0, p2: 105 });
    // RoomDO only opens the rematch flow for a finished room.
    expect(applied.state.phase).toBe("finished");

    const gameWon = applied.events.find((candidate) => candidate.type === "indian-poker.gameWon");
    expect(gameWon).toMatchObject({
      visibility: "system",
      payload: { winnerPlayerId: "p2", eliminatedPlayerId: "p1" }
    });

    const publicView = indianPokerDefinition.getPublicView({ state: applied.state, now: NOW });
    expect(publicView.winnerPlayerId).toBe("p2");
    expect(publicView.currentPlayerId).toBeUndefined();
    expect(publicView.availableActions).toEqual([]);
  });

  it("keeps playing while both players still have chips", () => {
    const state = initState();
    setCards(state, { p1: "2H", p2: "AS" });
    const applied = act(act(state, "p1", "check").state, "p2", "check");

    expect(stageOf(applied.state).phase).toBe("reveal");
    expect(applied.state.phase).toBe("active");
    expect(applied.events.some((candidate) => candidate.type === "indian-poker.gameWon")).toBe(false);
  });
});

describe("indian-poker turn derivation", () => {
  it("points at the player who still owes a nextRound request", () => {
    const revealed = act(initState(), "p1", "die").state;
    const stage = stageOf(revealed);

    // RoomDO schedules bot turns from the public currentPlayerId, so the reveal
    // handshake has to advertise a pending player or a bot would stall.
    expect(pendingPlayerId(stage, revealed.players)).toBe("p1");
    expect(indianPokerDefinition.getPublicView({ state: revealed, now: NOW }).currentPlayerId).toBe("p1");

    const requested = act(revealed, "p1", "nextRound").state;
    expect(pendingPlayerId(stageOf(requested), requested.players)).toBe("p2");
  });

  it("offers only nextRound during the reveal", () => {
    const revealed = act(initState(), "p1", "die").state;
    expect(availableActions(stageOf(revealed), "p1")).toEqual(["nextRound"]);

    const requested = act(revealed, "p1", "nextRound").state;
    expect(availableActions(stageOf(requested), "p1")).toEqual([]);
    expect(availableActions(stageOf(requested), "p2")).toEqual(["nextRound"]);
  });
});

describe("indian-poker bot", () => {
  function botState(): RoomState {
    const state = initState();
    state.players[1] = { ...state.players[1]!, kind: "bot", botDifficulty: "medium" };
    return state;
  }

  it("never reads its own card", () => {
    const state = botState();
    setCards(state, { p1: "2C", p2: "AS" });
    const stage = stageOf(state);
    stage.currentPlayerId = "p2";

    // The bot sees a 2 on the other forehead, so it should not fold.
    const action = indianPokerDefinition.selectBotAction?.({
      state: cloneState(state),
      now: NOW,
      player: state.players[1]!,
      difficulty: "medium"
    });
    expect(action?.type).not.toBe("die");
  });

  it("answers the reveal handshake exactly once", () => {
    const revealed = act(botState(), "p1", "die").state;
    const bot = revealed.players[1]!;

    const first = indianPokerDefinition.selectBotAction?.({
      state: cloneState(revealed),
      now: NOW,
      player: bot,
      difficulty: "medium"
    });
    expect(first).toMatchObject({ type: "nextRound" });

    const requested = act(revealed, "p2", "nextRound").state;
    const second = indianPokerDefinition.selectBotAction?.({
      state: cloneState(requested),
      now: NOW,
      player: bot,
      difficulty: "medium"
    });
    // Without this guard RoomDO would reschedule the bot turn forever.
    expect(second).toBeNull();
  });

  it("only picks actions the rules accept", () => {
    const difficulties = ["low", "medium", "high"] as const;
    for (const difficulty of difficulties) {
      let state = botState();
      stageOf(state).currentPlayerId = "p2";
      for (let step = 0; step < 12; step += 1) {
        const stage = stageOf(state);
        if (stage.phase === "gameOver") break;
        const turnPlayerId = pendingPlayerId(stage, state.players);
        if (!turnPlayerId) break;
        const player = state.players.find((candidate) => candidate.playerId === turnPlayerId)!;
        const selected = indianPokerDefinition.selectBotAction?.({
          state: cloneState(state),
          now: NOW,
          player,
          difficulty
        });
        if (!selected) break;
        const validation = indianPokerDefinition.validateAction(
          { state: cloneState(state), now: NOW },
          {
            playerId: turnPlayerId,
            clientActionId: `bot_${difficulty}_${step}`,
            expectedVersion: state.version,
            type: selected.type,
            payload: selected.payload
          }
        );
        expect(validation, `${difficulty} step ${step}: ${selected.type}`).toEqual({ ok: true });
        state = act(state, turnPlayerId, selected.type, selected.payload).state;
      }
      expect(totalChips(state)).toBe(200);
    }
  });
});

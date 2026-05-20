import { describe, expect, it } from "vitest";
import { cloneState, type RoomState } from "../src/core/game";
import { oneCardDefinition } from "@bighouse/onecard/server";

function baseState(numPlayers = 2): RoomState {
  const players = Array.from({ length: numPlayers }, (_, i) => ({
    playerId: `p${i + 1}`,
    seat: i,
    connected: true,
    ready: true,
    joinedAt: 1
  }));
  return {
    room: {
      roomId: "room_unit",
      gameId: "onecard",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 4,
      config: {},
      createdAt: 1
    },
    phase: "active",
    version: 2,
    players,
    stageState: {},
    playerStates: {},
    updatedAt: 1
  };
}

describe("One Card Game Logic", () => {
  it("initializes a waiting room before players join", () => {
    const state = baseState(0);
    const stage = oneCardDefinition.initialStageState({ room: state.room, players: [], now: 1 }) as any;

    expect(stage.discardPile).toHaveLength(0);
    expect(stage.currentPlayerId).toBeUndefined();
    expect(stage.deckCount).toBe(stage.deck.length);
  });

  it("initializes game state with correct deal and stage deck", () => {
    const state = baseState(2);
    state.stageState = oneCardDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = oneCardDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = oneCardDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });

    const stage = state.stageState as any;
    expect(stage.discardPile).toHaveLength(1);
    expect(stage.discardPile[0]).not.toBe("BJ");
    expect(stage.discardPile[0]).not.toBe("CJ");
    expect(stage.currentPlayerId).toBe("p1");

    const p1State = state.playerStates.p1 as any;
    const p2State = state.playerStates.p2 as any;
    expect(p1State.hand).toHaveLength(7);
    expect(p2State.hand).toHaveLength(7);

    // Confirm total deck count + hands + top card = 54
    const totalCount = stage.deck.length + stage.discardPile.length + p1State.hand.length + p2State.hand.length;
    expect(totalCount).toBe(54);
  });

  it("keeps player hands secure in getPublicView while allowing getPrivateView", () => {
    const state = baseState(2);
    state.stageState = oneCardDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = oneCardDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = oneCardDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });

    const publicView = oneCardDefinition.getPublicView({ state, now: 1 }) as any;
    expect(publicView.hands.p1.count).toBe(7);
    expect(publicView.hands.p2.count).toBe(7);
    // Secure check: no cards are leaked
    expect(publicView.hands.p1.hand).toBeUndefined();
    expect(publicView.hands.p2.hand).toBeUndefined();

    const privateView = oneCardDefinition.getPrivateView({ state, now: 1 }, "p1") as any;
    expect(privateView.hand).toHaveLength(7);
  });

  it("validates turns and matching moves", () => {
    const state = baseState(2);
    state.stageState = {
      discardPile: ["5S"],
      deck: ["AH"],
      deckCount: 1,
      currentPlayerId: "p1",
      turnDirection: "clockwise",
      activeAttackCount: 0,
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    };
    state.playerStates.p1 = { hand: ["5H", "7S", "10D"] };
    state.playerStates.p2 = { hand: ["5C"] };

    // Turn check
    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(state), now: 1 },
        { playerId: "p2", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "5C" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_turn" });

    // Card in hand check
    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(state), now: 1 },
        { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "5C" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "Player does not hold that card" });

    // Invalid normal play match check
    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(state), now: 1 },
        { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "10D" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "Card must match the top card's suit or number" });

    // Match suit (7S matches 5S)
    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(state), now: 1 },
        { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "7S", chosenSuit: "S" } }
      )
    ).toMatchObject({ ok: true });

    // Match number (5H matches 5S)
    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(state), now: 1 },
        { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "5H" } }
      )
    ).toMatchObject({ ok: true });
  });

  it("handles J (Skip), Q (Reverse), K (Extra Turn) and pass actions", () => {
    // 3 players to verify Q and J correctly
    const state = baseState(3);
    state.stageState = {
      discardPile: ["5S"],
      deck: ["10S", "9S"],
      deckCount: 2,
      currentPlayerId: "p1",
      turnDirection: "clockwise",
      activeAttackCount: 0,
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    };
    state.playerStates.p1 = { hand: ["JS", "QS", "KS", "7S"] };
    state.playerStates.p2 = { hand: ["2H"] };
    state.playerStates.p3 = { hand: ["3H"] };

    // Q (Reverse) play
    let result = oneCardDefinition.applyAction(
      { state: cloneState(state), now: 1 },
      { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "QS" } }
    );
    // Turn should reverse: clockwise from p1 goes next to p3 (counterclockwise)
    expect(result.state.stageState).toMatchObject({
      turnDirection: "counterclockwise",
      currentPlayerId: "p3"
    });

    // J (Skip) play
    result = oneCardDefinition.applyAction(
      { state: cloneState(state), now: 1 },
      { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "JS" } }
    );
    // From p1, next is p2, but skipped, so currentPlayerId should be p3 (in clockwise)
    expect(result.state.stageState).toMatchObject({
      currentPlayerId: "p3"
    });

    // K (Extra turn) play
    result = oneCardDefinition.applyAction(
      { state: cloneState(state), now: 1 },
      { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "KS" } }
    );
    // Extra turn active, currentPlayerId remains p1
    expect(result.state.stageState).toMatchObject({
      currentPlayerId: "p1",
      hasExtraTurn: true
    });

    // p1 can play another card from hand or pass. Let's pass:
    const passResult = oneCardDefinition.applyAction(
      { state: cloneState(result.state), now: 1 },
      { playerId: "p1", clientActionId: "a2", expectedVersion: 2, type: "pass", payload: {} }
    );
    expect(passResult.state.stageState).toMatchObject({
      currentPlayerId: "p2",
      hasExtraTurn: false
    });

    // Or play a card:
    const playNextResult = oneCardDefinition.applyAction(
      { state: cloneState(result.state), now: 1 },
      { playerId: "p1", clientActionId: "a2", expectedVersion: 2, type: "playCard", payload: { card: "7S", chosenSuit: "S" } }
    );
    expect(playNextResult.state.stageState).toMatchObject({
      currentPlayerId: "p2",
      hasExtraTurn: false
    });
  });

  it("handles wild Joker suit choosing", () => {
    const state = baseState(2);
    state.stageState = {
      discardPile: ["5S"],
      deck: ["10S", "9S", "8S", "7S", "6S", "5S", "4S"],
      deckCount: 7,
      currentPlayerId: "p1",
      turnDirection: "clockwise",
      activeAttackCount: 0,
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    };
    state.playerStates.p1 = { hand: ["BJ", "7H"] };
    state.playerStates.p2 = { hand: ["3H", "3D"] };

    // Play BJ, choosing Hearts (starts attack of 5 cards)
    const result = oneCardDefinition.applyAction(
      { state: cloneState(state), now: 1 },
      { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "BJ", chosenSuit: "H" } }
    );
    expect(result.state.stageState).toMatchObject({
      chosenSuit: "H",
      currentPlayerId: "p2",
      activeAttackCount: 5
    });

    // p2 draws cards to resolve the attack
    const afterDraw = oneCardDefinition.applyAction(
      { state: cloneState(result.state), now: 1 },
      { playerId: "p2", clientActionId: "a2", expectedVersion: 2, type: "drawCard", payload: {} }
    );
    expect(afterDraw.state.stageState).toMatchObject({
      chosenSuit: "H",
      currentPlayerId: "p1",
      activeAttackCount: 0
    });

    // Now it is p1's turn again. Top card is BJ, chosenSuit is H.
    // p1 has "7H" (matches H) and "7S" (does not match H).
    const p1State = afterDraw.state.playerStates.p1 as any;
    p1State.hand = ["7H", "7S"];

    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(afterDraw.state), now: 1 },
        { playerId: "p1", clientActionId: "a3", expectedVersion: 2, type: "playCard", payload: { card: "7S" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "Must match the chosen suit: H" });

    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(afterDraw.state), now: 1 },
        { playerId: "p1", clientActionId: "a3", expectedVersion: 2, type: "playCard", payload: { card: "7H" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "chosenSuit is required for a 7 or Joker" });

    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(afterDraw.state), now: 1 },
        { playerId: "p1", clientActionId: "a4", expectedVersion: 2, type: "playCard", payload: { card: "7H", chosenSuit: "H" } }
      )
    ).toMatchObject({ ok: true });
  });

  it("validates suit choices and lets sevens change the active suit", () => {
    const state = baseState(2);
    state.stageState = {
      discardPile: ["5S"],
      deck: ["10S"],
      deckCount: 1,
      currentPlayerId: "p1",
      turnDirection: "clockwise",
      activeAttackCount: 0,
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    };
    state.playerStates.p1 = { hand: ["7S", "5H", "BJ"] };
    state.playerStates.p2 = { hand: ["3H"] };

    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(state), now: 1 },
        { playerId: "p1", clientActionId: "bad-suit", expectedVersion: 2, type: "playCard", payload: { card: "BJ", chosenSuit: "X" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "chosenSuit must be S, H, C, or D" });

    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(state), now: 1 },
        { playerId: "p1", clientActionId: "missing-joker-suit", expectedVersion: 2, type: "playCard", payload: { card: "BJ" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "chosenSuit is required for a 7 or Joker" });

    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(state), now: 1 },
        { playerId: "p1", clientActionId: "missing-seven-suit", expectedVersion: 2, type: "playCard", payload: { card: "7S" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "chosenSuit is required for a 7 or Joker" });

    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(state), now: 1 },
        { playerId: "p1", clientActionId: "bad-card-suit", expectedVersion: 2, type: "playCard", payload: { card: "5H", chosenSuit: "D" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "Only a 7 or Joker can choose a suit" });

    const result = oneCardDefinition.applyAction(
      { state: cloneState(state), now: 1 },
      { playerId: "p1", clientActionId: "seven", expectedVersion: 2, type: "playCard", payload: { card: "7S", chosenSuit: "H" } }
    );
    expect(result.state.stageState).toMatchObject({ chosenSuit: "H", currentPlayerId: "p2" });

    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(result.state), now: 1 },
        { playerId: "p2", clientActionId: "match-choice", expectedVersion: 3, type: "playCard", payload: { card: "3H" } }
      )
    ).toMatchObject({ ok: true });
  });

  it("handles attack stacking, defense, and stacked drawing", () => {
    const state = baseState(2);
    state.stageState = {
      discardPile: ["5S"],
      deck: ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"],
      deckCount: 8,
      currentPlayerId: "p1",
      turnDirection: "clockwise",
      activeAttackCount: 0,
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    };
    state.playerStates.p1 = { hand: ["2S", "AS", "BJ"] };
    state.playerStates.p2 = { hand: ["AH", "CJ", "7H"] };

    // p1 plays 2S (+2 attack)
    let result = oneCardDefinition.applyAction(
      { state: cloneState(state), now: 1 },
      { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "2S" } }
    );
    expect(result.state.stageState).toMatchObject({
      activeAttackCount: 2,
      activeAttackCard: "2S",
      currentPlayerId: "p2"
    });

    // p2 cannot play a non-defense card (e.g. 7H)
    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(result.state), now: 1 },
        { playerId: "p2", clientActionId: "a2", expectedVersion: 2, type: "playCard", payload: { card: "7H" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "Must defend attack with a 2, A, or Joker" });

    // p2 plays AH (+3 attack) to defend
    result = oneCardDefinition.applyAction(
      { state: cloneState(result.state), now: 1 },
      { playerId: "p2", clientActionId: "a2", expectedVersion: 2, type: "playCard", payload: { card: "AH" } }
    );
    expect(result.state.stageState).toMatchObject({
      activeAttackCount: 5,
      activeAttackCard: "AH",
      currentPlayerId: "p1"
    });

    // p1 plays BJ (+5 attack)
    result = oneCardDefinition.applyAction(
      { state: cloneState(result.state), now: 1 },
      { playerId: "p1", clientActionId: "a3", expectedVersion: 2, type: "playCard", payload: { card: "BJ", chosenSuit: "C" } }
    );
    expect(result.state.stageState).toMatchObject({
      activeAttackCount: 10,
      activeAttackCard: "BJ",
      currentPlayerId: "p2"
    });

    // p2 can defend BJ with CJ (+7 attack)
    result = oneCardDefinition.applyAction(
      { state: cloneState(result.state), now: 1 },
      { playerId: "p2", clientActionId: "a4", expectedVersion: 2, type: "playCard", payload: { card: "CJ", chosenSuit: "H" } }
    );
    expect(result.state.stageState).toMatchObject({
      activeAttackCount: 17,
      activeAttackCard: "CJ",
      currentPlayerId: "p1"
    });

    // CJ cannot be defended! Even if p1 holds another defense card, they must draw.
    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(result.state), now: 1 },
        { playerId: "p1", clientActionId: "a5", expectedVersion: 2, type: "playCard", payload: { card: "AS" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "Color Joker attack cannot be defended" });

    // p1 draws cards (17 cards total stacked)
    // Draw event triggers, stack resets, turn passes
    const drawResult = oneCardDefinition.applyAction(
      { state: cloneState(result.state), now: 1 },
      { playerId: "p1", clientActionId: "a5", expectedVersion: 2, type: "drawCard", payload: {} }
    );
    expect(drawResult.state.stageState).toMatchObject({
      activeAttackCount: 0,
      currentPlayerId: "p2"
    });
    expect((drawResult.state.stageState as any).activeAttackCard).toBeUndefined();
  });

  it("allows drawing through a +2 attack when the player has no defense card", () => {
    const state = baseState(2);
    state.stageState = {
      discardPile: ["5S", "2S"],
      deck: ["9D", "10C", "QH"],
      deckCount: 3,
      currentPlayerId: "p2",
      turnDirection: "clockwise",
      activeAttackCount: 2,
      activeAttackCard: "2S",
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    };
    state.playerStates.p1 = { hand: ["6H"] };
    state.playerStates.p2 = { hand: ["3C", "7D"] };

    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(state), now: 1 },
        { playerId: "p2", clientActionId: "bad-defense", expectedVersion: 2, type: "playCard", payload: { card: "3C" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "Must defend attack with a 2, A, or Joker" });
    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(state), now: 1 },
        { playerId: "p2", clientActionId: "draw-attack", expectedVersion: 2, type: "drawCard", payload: {} }
      )
    ).toMatchObject({ ok: true });

    const result = oneCardDefinition.applyAction(
      { state: cloneState(state), now: 1 },
      { playerId: "p2", clientActionId: "draw-attack", expectedVersion: 2, type: "drawCard", payload: {} }
    );

    expect(result.state.stageState).toMatchObject({
      activeAttackCount: 0,
      currentPlayerId: "p1"
    });
    expect((result.state.stageState as any).activeAttackCard).toBeUndefined();
    expect((result.state.playerStates.p2 as any).hand).toHaveLength(4);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "onecard.playerDrawnCount",
        visibility: "public",
        payload: expect.objectContaining({ playerId: "p2", count: 2, wasAttack: true })
      })
    );
  });

  it("recycles the deck when it runs out", () => {
    const state = baseState(2);
    state.stageState = {
      discardPile: ["2S", "3S", "4S", "5S"], // 5S is top
      deck: [], // Empty
      deckCount: 0,
      currentPlayerId: "p1",
      turnDirection: "clockwise",
      activeAttackCount: 0,
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    };
    state.playerStates.p1 = { hand: ["7S"] };
    state.playerStates.p2 = { hand: ["8S"] };

    // p1 draws a card
    const result = oneCardDefinition.applyAction(
      { state: cloneState(state), now: 1 },
      { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "drawCard", payload: {} }
    );

    const stage = result.state.stageState as any;
    // The top card "5S" must remain in discardPile.
    // "2S", "3S", "4S" should be recycled. 1 is drawn, so 2 remain in deck.
    expect(stage.discardPile).toEqual(["5S"]);
    expect(stage.deckCount).toBe(2);
    expect((result.state.playerStates.p1 as any).hand).toHaveLength(2); // 7S + 1 drawn
  });

  it("handles win and bankruptcy triggers correctly", () => {
    const state = baseState(2);
    state.stageState = {
      discardPile: ["5S"],
      deck: Array.from({ length: 20 }, (_, i) => `C${i + 1}`),
      deckCount: 20,
      currentPlayerId: "p1",
      turnDirection: "clockwise",
      activeAttackCount: 0,
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    };
    state.playerStates.p1 = { hand: ["7S"] };
    state.playerStates.p2 = { hand: Array.from({ length: 15 }, (_, i) => `D${i + 1}`) };

    // Win check: p1 plays their last card
    const result = oneCardDefinition.applyAction(
      { state: cloneState(state), now: 1 },
      { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "7S", chosenSuit: "S" } }
    );
    expect(result.state.phase).toBe("finished");
    expect(result.state.stageState).toMatchObject({
      winnerPlayerId: "p1"
    });

    // Bankruptcy check: p2 is at 15 cards, draws 1 card, reaching 16 -> Bankrupt!
    const stateForDraw = cloneState(state);
    stateForDraw.stageState.currentPlayerId = "p2";
    const bankruptResult = oneCardDefinition.applyAction(
      { state: stateForDraw, now: 1 },
      { playerId: "p2", clientActionId: "a2", expectedVersion: 2, type: "drawCard", payload: {} }
    );

    // p2 was eliminated. Since there is only p1 left, p1 wins!
    expect(bankruptResult.state.phase).toBe("finished");
    expect(bankruptResult.state.stageState).toMatchObject({
      eliminatedPlayerIds: ["p2"],
      winnerPlayerId: "p1"
    });
  });

  it("skips only active players when some players are eliminated", () => {
    // 3 players: p1, p2, p3
    const state = baseState(3);
    state.stageState = {
      discardPile: ["5S"],
      deck: ["8S", "9S"],
      deckCount: 2,
      currentPlayerId: "p1",
      turnDirection: "clockwise",
      activeAttackCount: 0,
      eliminatedPlayerIds: ["p2"], // p2 is out
      hasExtraTurn: false
    };
    state.playerStates.p1 = { hand: ["JS", "8S"] };
    state.playerStates.p2 = { hand: [] };
    state.playerStates.p3 = { hand: ["9S"] };

    // p1 plays a Jack (JS). It should skip the next active player (p3),
    // and since p2 is eliminated, the turn should return to p1!
    const result = oneCardDefinition.applyAction(
      { state: cloneState(state), now: 1 },
      { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "JS" } }
    );

    const stage = result.state.stageState as any;
    expect(stage.currentPlayerId).toBe("p1");
  });
});

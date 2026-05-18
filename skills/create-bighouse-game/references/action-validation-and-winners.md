# Action Validation and Winner Logic

Game adapters must validate first, mutate second.

## validateAction()

Validate:

- Supported `action.type`.
- Required payload fields and their types.
- Room phase.
- Player membership if adapter-specific checks are needed.
- Turn ownership.
- Position bounds.
- Resource availability.
- Hand/card ownership.
- Whether the game is already over.

Return stable failures:

```ts
return { ok: false, code: "invalid_turn", message: "It is not this player's turn" };
return { ok: false, code: "invalid_action", message: "Cell is already occupied" };
```

Do not mutate:

- No writes to `context.state.stageState`.
- No writes to `context.state.playerStates`.
- No event creation required.
- No random draws unless they are purely deterministic previews.

## applyAction()

Apply exactly one valid action:

- Read the current stage/player state.
- Apply the mutation.
- Advance turn or phase.
- Check winner/terminal conditions.
- Build events.
- Return `{ state, events }`.

Do not increment `state.version`. `RoomDO` increments it after `applyAction()`.

## Turn Handling

Use a deterministic player order, usually `state.players` by seat.

Pattern:

```ts
const currentPlayerId = stage.currentPlayerId ?? state.players[0]?.playerId;
if (action.playerId !== currentPlayerId) {
  return { ok: false, code: "invalid_turn", message: "It is not this player's turn" };
}
```

After a valid action:

```ts
const next = nextPlayer(state.players, action.playerId);
if (next) {
  stage.currentPlayerId = next.playerId;
}
```

## Winner and Terminal State

Winner logic must be deterministic and local to the authoritative state.

When the game ends:

```ts
stage.winnerPlayerId = action.playerId;
state.phase = "closed";
state.closedAt = context.now;
events.push({
  id: createId("evt"),
  type: "my-game.gameWon",
  visibility: "system",
  payload: { winnerPlayerId: action.playerId },
  createdAt: context.now
});
```

`RoomDO` synchronizes closed rooms to D1 `room_index` and `match_results`.

Winner tests must cover:

- Non-winning valid move/action.
- Winning move/action.
- Action rejected after winner is set.
- Correct system event payload.

## Randomness

If a game needs random draws:

- Keep the resulting authoritative value in `stageState` or `playerStates`.
- Never rely on client-provided random choices.
- Make tests deterministic by using fixed decks, fixed seeds, or test-specific state.
- Do not expose hidden random results through public views or public events.

## Timers

Use `nextTimers()` to request alarms.

- Return no timers when room is waiting or closed.
- Return a turn timeout when active turn has a deadline.
- Keep timer payload small.
- Timer handling in `RoomDO` is generic; adapter-specific timeout transitions may need a future core extension.

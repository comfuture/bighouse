# State Visibility Guide

Bighouse intentionally separates authoritative state from client-visible projections.

## Internal State Layers

`stageState`

- Room-level authoritative state.
- Use for board, table, round, deck count, visible stacks, current turn, timers, and winner.
- It may contain hidden data only if `getPublicView()` filters it out, but prefer storing player-specific secrets in `playerStates`.

`playerStates`

- Per-player authoritative state.
- Use for hand, secret role, hidden objective, private resources, private score, selected but unrevealed action, and personal effects.

`events`

- Transition output.
- Use `visibility` to determine delivery.

## Visibility Rules

Public global-state games:

- Board/table is public.
- `getPublicView()` can expose most of `stageState`.
- `playerStates` should contain only seat-derived or personal details.
- Example: gomoku exposes `board`, `currentPlayerId`, `turnDeadline`, `moveCount`, and `winnerPlayerId`.

Hidden player-state games:

- Table state is public.
- Player secrets are private.
- `getPublicView()` must expose summaries only: hand count, stack count, ready flag, visible cards, bet amount.
- `getPrivateView()` returns only `playerStates[playerId]` or a safe projection of it.
- Example: card games expose `discardPile`, `deckCount`, `round`, and hand counts, but not actual hands.

Mixed games:

- Default to hidden.
- Add public projections explicitly.
- Never assume a field is safe because it is convenient for the UI.

## Event Visibility

Use `public` when all participants may know the exact result:

- Piece placed.
- Public card played.
- Public score update.
- Turn changed.

Use `private` when only one player may know the result:

- Card drawn.
- Secret role assigned.
- Private reward.
- Hidden objective update.

Use `system` for global room/game lifecycle information:

- Game started.
- Game won.
- Room closed.
- Timeout occurred.

Private event rule:

```ts
{
  visibility: "private",
  playerId: targetPlayerId,
  payload: { ... }
}
```

If `playerId` is missing from a private event, the event cannot be delivered correctly.

## Red Flags

- `getPublicView()` returns `context.state.playerStates`.
- Public event payload includes another player's hand, role, or secret objective.
- Tests only check the acting player's view.
- Private state is encoded into action acknowledgements.
- Chat messages are treated as game events.

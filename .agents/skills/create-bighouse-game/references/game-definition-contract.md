# GameDefinition Contract

Every Bighouse game is implemented as a `GameDefinition` in `src/games/<game-id>.ts`.

```ts
export type GameDefinition = {
  gameId: string;
  adapterKey: string;
  displayName: string;
  minPlayers: number;
  maxPlayers: number;
  initialStageState(context): JsonObject;
  initialPlayerState(player, context): JsonObject;
  validateAction(context, action): ValidationResult;
  applyAction(context, action): ActionResult;
  getPublicView(context): JsonObject;
  getPrivateView(context, playerId): JsonObject;
  nextTimers(context): TimerIntent[];
};
```

## Required Invariants

- `gameId` must be stable and URL-safe, for example `gomoku`, `card-demo`, or `my-game`.
- `adapterKey` should match `gameId` unless there is a deliberate compatibility reason.
- `minPlayers` must be at least `1`.
- `maxPlayers` must be greater than or equal to `minPlayers`.
- `initialStageState()` creates room-level authoritative state.
- `initialPlayerState()` creates one player's private/seat-derived state when they join.
- `validateAction()` checks but does not mutate.
- `applyAction()` applies exactly one already-valid action.
- `getPublicView()` returns only information every participant may see.
- `getPrivateView()` returns only the requesting player's private information.
- `nextTimers()` returns desired alarm intents. It must be deterministic for the current state.

## RoomDO Responsibilities

Do not duplicate these responsibilities in the adapter:

- Idempotency for repeated `clientActionId`.
- Stale `expectedVersion` rejection.
- Room version increment.
- DO SQLite persistence.
- WebSocket delivery.
- D1 room/result synchronization after `state.phase = "closed"`.

## Adapter Responsibilities

The adapter must decide:

- Which action types exist.
- Which payload fields are required.
- Whether the player is allowed to act now.
- How state changes after a valid action.
- Which events are emitted.
- Whether the game has a winner or terminal result.
- What public/private projections are safe.

## Registration

After creating the adapter, register it in `src/games/index.ts`.

```ts
import { myGameDefinition } from "./my-game";
registerGame(myGameDefinition);
```

Without registration, `GET /games` will not seed the game and RoomDO cannot resolve the adapter.

# Testing Checklist

Every new game adapter should include tests under `test/<game-id>.test.ts`.

## Adapter Unit Tests

Required:

- `initialStageState()` returns valid room-level state.
- `initialPlayerState()` returns correct per-player state.
- `getPublicView()` contains expected public fields.
- `getPublicView()` does not leak private fields.
- `getPrivateView()` returns only the requesting player's data.
- `validateAction()` accepts a valid action.
- `validateAction()` rejects unsupported action types.
- `validateAction()` rejects invalid turn.
- `validateAction()` rejects invalid payloads.
- `applyAction()` mutates expected state.
- `applyAction()` emits events with correct visibility.

## RoomDO Integration Tests

Use `env.ROOM_DO.getByName(...)` when room lifecycle behavior matters.

Cover:

- Initialize room.
- Join min players.
- Active phase begins.
- Submit valid action.
- Duplicate `clientActionId` returns same acknowledgement.
- Stale `expectedVersion` is rejected.
- Invalid turn is rejected.
- Winning action closes room.
- D1 room/result sync if terminal state is involved.

## Visibility Tests

For hidden-state games:

- Serialize `publicView` and assert it does not contain known secret values.
- Assert current player's `privateView` contains their own secret values.
- Assert another player's `privateView` does not contain the current player's secrets.
- Assert private events are targeted with `playerId`.

For public-state games:

- Assert all required board/table fields exist in `publicView`.
- Assert public events include enough payload for clients to update incrementally.

## Commands

Always run:

```sh
pnpm typecheck
pnpm test
```

If HTTP/WebSocket routes are affected, also run:

```sh
pnpm exec wrangler deploy --dry-run
```
